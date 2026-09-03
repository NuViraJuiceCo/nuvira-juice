import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const SCHEDULE_FAILURE_MESSAGE = 'We’re having trouble confirming your delivery window right now. Please try again in a few minutes or contact NuVira support.';
const STALE_DELIVERY_SELECTION_MESSAGE = 'That delivery window is no longer available. Please select a new delivery window.';
const GOOGLE_PAY_REQUIRED_DOMAINS = Object.freeze([
  'nuvirajuice.com',
  'www.nuvirajuice.com',
]);
const GOOGLE_PAY_DOMAIN_CONFIRMATION = 'ENSURE_GOOGLE_PAY_DOMAINS';
const CHECKOUT_PROVIDER_SANDBOX_CONFIRMATION = 'RUN_GUEST_CHECKOUT_PROVIDER_SANDBOX';
const META_CAPI_PROVIDER_SANDBOX_CONFIRMATION = 'RUN_META_CAPI_PROVIDER_SANDBOX';
const CHECKOUT_PROVIDER_SANDBOX_RECIPIENT = 'delivered+g136-guest-checkout@resend.dev';
const HEALTH_ADVISORY_VERSION = '2026-05-13-v1';
const PROGRAM_SCHEDULE_VERSION = '2026-08-09.v2';
const PROGRAM_ORDER_OPTIONS = Object.freeze({
  radiance: Object.freeze({
    2: Object.freeze({ price: 104, bottles: 8, composition: Object.freeze([
      Object.freeze({ product_id: 'aura', product_name: 'AURA', quantity: 6 }),
      Object.freeze({ product_id: 'oasis', product_name: 'OASIS', quantity: 2 }),
    ]) }),
    3: Object.freeze({ price: 144, bottles: 12, composition: Object.freeze([
      Object.freeze({ product_id: 'aura', product_name: 'AURA', quantity: 9 }),
      Object.freeze({ product_id: 'oasis', product_name: 'OASIS', quantity: 3 }),
    ]) }),
  }),
  hydration: Object.freeze({
    2: Object.freeze({ price: 104, bottles: 8, composition: Object.freeze([
      Object.freeze({ product_id: 'oasis', product_name: 'OASIS', quantity: 6 }),
      Object.freeze({ product_id: 'aura', product_name: 'AURA', quantity: 2 }),
    ]) }),
    3: Object.freeze({ price: 144, bottles: 12, composition: Object.freeze([
      Object.freeze({ product_id: 'oasis', product_name: 'OASIS', quantity: 9 }),
      Object.freeze({ product_id: 'aura', product_name: 'AURA', quantity: 3 }),
    ]) }),
  }),
  reset: Object.freeze({
    3: Object.freeze({ price: 144, bottles: 12, composition: Object.freeze([
      Object.freeze({ product_id: 're-nu', product_name: 'RE-NU', quantity: 9 }),
      Object.freeze({ product_id: 'oasis', product_name: 'OASIS', quantity: 3 }),
    ]) }),
  }),
});

function programKeyForCheckoutItem(item) {
  const explicit = String(item?.program_key || '').trim().toLowerCase();
  if (PROGRAM_ORDER_OPTIONS[explicit]) return explicit;
  const productId = String(item?.product_id || item?.id || '').trim().toLowerCase();
  const title = String(item?.title || item?.name || '').trim().toLowerCase();
  return Object.keys(PROGRAM_ORDER_OPTIONS).find((key) => (
    productId === `program_${key}`
      || productId === `program-${key}`
      || productId.startsWith(`program_${key}_`)
      || productId.startsWith(`program-${key}-`)
      || title.includes(`${key} program`)
  )) || null;
}

function programDaysForCheckoutItem(item, programKey) {
  const productId = String(item?.product_id || item?.id || '').trim().toLowerCase();
  const title = String(item?.title || item?.name || '').trim().toLowerCase();
  const idMatch = productId.match(/[_-](2|3)day$/);
  const titleMatch = title.match(/\((2|3)-day\)/);
  const requested = Number(item?.program_days || idMatch?.[1] || titleMatch?.[1] || 3);
  return PROGRAM_ORDER_OPTIONS[programKey]?.[requested] ? requested : null;
}

function normalizeCheckoutItem(item) {
  const base = {
    product_id: item.product_id,
    title: item.title,
    price: Number(item.price),
    quantity: Number(item.quantity),
    image_url: item.image_url || null,
    category: item.category || null,
    size: item.size || null,
  };
  const programKey = programKeyForCheckoutItem(item);
  if (!programKey) {
    const addonProgramKey = String(item?.program_addon_for || '').trim().toLowerCase();
    const addonDays = Number(item?.program_addon_days || 0);
    if (base.category === 'shot' && PROGRAM_ORDER_OPTIONS[addonProgramKey]?.[addonDays]) {
      return {
        ...base,
        program_addon_for: addonProgramKey,
        program_addon_days: addonDays,
        program_addon_schedule_version: PROGRAM_SCHEDULE_VERSION,
      };
    }
    return base;
  }
  const programDays = programDaysForCheckoutItem(item, programKey);
  const option = programDays ? PROGRAM_ORDER_OPTIONS[programKey][programDays] : null;
  if (!option) return base;
  return {
    ...base,
    product_id: `program_${programKey}_${programDays}day`,
    title: `${programKey[0].toUpperCase()}${programKey.slice(1)} Program (${programDays}-Day)`,
    category: 'bundle',
    is_program: true,
    program_key: programKey,
    program_days: programDays,
    program_schedule_version: PROGRAM_SCHEDULE_VERSION,
    bottles_per_unit: option.bottles,
    bundle_composition: option.composition.map((component) => ({ ...component })),
  };
}

function invalidProgramCheckoutItem(item) {
  const programKey = programKeyForCheckoutItem(item);
  if (!programKey) return false;
  const programDays = programDaysForCheckoutItem(item, programKey);
  if (!programDays) return true;
  return Number(item?.price) !== PROGRAM_ORDER_OPTIONS[programKey][programDays].price;
}

function normalizePromotionCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeCustomerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidCustomerEmail(value) {
  const normalized = normalizeCustomerEmail(value);
  return normalized.length > 3 && normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function normalizeGoogleMeasurementContext(value) {
  const clientId = String(value?.client_id || '').trim();
  const sessionId = String(value?.session_id || '').trim();
  const capturedAt = String(value?.captured_at || '').trim();
  if (!/^\d{1,20}\.\d{1,20}$/.test(clientId) || !/^\d{1,20}$/.test(sessionId) || Number(sessionId) <= 0) {
    return null;
  }
  const capturedTimestamp = Date.parse(capturedAt);
  return {
    client_id: clientId,
    session_id: sessionId,
    captured_at: Number.isFinite(capturedTimestamp) ? new Date(capturedTimestamp).toISOString() : new Date().toISOString(),
  };
}

function isValidGuestSecret(value) {
  const normalized = String(value || '').trim();
  return normalized.length >= 24 && normalized.length <= 180 && /^[A-Za-z0-9._:-]+$/.test(normalized);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function guestAccountBenefitsRequested(body) {
  return Number(body?.points_discount || 0) !== 0
    || Number(body?.points_used || 0) !== 0
    || Number(body?.reward_discount || 0) !== 0
    || Number(body?.credits_discount || 0) !== 0
    || Boolean(body?.active_reward)
    || Boolean(String(body?.bag_return_request_id || '').trim());
}

async function authoritativeGuestCheckoutItems(base44, requestedItems) {
  const availableProducts = await base44.asServiceRole.entities.Product.filter(
    { is_available: true },
    'sort_order',
    250,
  );
  const productById = Object.fromEntries(
    availableProducts.map((product) => [String(product?.id || '').trim(), product]),
  );
  const resolved = [];
  for (const requestedItem of requestedItems) {
    const programKey = programKeyForCheckoutItem(requestedItem);
    if (programKey) {
      const programDays = programDaysForCheckoutItem(requestedItem, programKey);
      const option = programDays ? PROGRAM_ORDER_OPTIONS[programKey]?.[programDays] : null;
      if (!option || Number(requestedItem?.price) !== option.price) return null;
      resolved.push(normalizeCheckoutItem({ ...requestedItem, price: option.price }));
      continue;
    }

    const productId = String(requestedItem?.product_id || '').trim();
    if (!productId || productId.startsWith('__')) return null;
    const product = productById[productId];
    if (!product) return null;
    const authoritativePrice = Number(product.price);
    if (!Number.isFinite(authoritativePrice) || authoritativePrice < 0) return null;
    resolved.push(normalizeCheckoutItem({
      ...requestedItem,
      product_id: product.id,
      title: product.title,
      price: authoritativePrice,
      image_url: product.image_url || requestedItem.image_url || null,
      category: product.category,
      size: product.size || requestedItem.size || null,
    }));
  }
  return resolved;
}

function sanitizeGuestConfirmationOrder(order) {
  if (!order) return null;
  return {
    order_number: order.order_number,
    customer_email: order.customer_email,
    customer_name: order.customer_name,
    contact_phone: order.contact_phone,
    items: Array.isArray(order.items) ? order.items.map((item) => ({
      title: item?.title || 'NuVira item',
      price: Number(item?.price || 0),
      quantity: Number(item?.quantity || 0),
    })) : [],
    total: Number(order.total || 0),
    status: order.status,
    payment_status: order.payment_status,
    payment_captured: order.payment_captured === true,
    assigned_delivery_date: order.assigned_delivery_date || null,
    estimated_delivery_date: order.estimated_delivery_date || null,
    earned_points: Math.max(0, Math.floor(Number(order.total || 0) * 10)),
    is_test_order: order.is_test_order === true,
  };
}

async function readGuestOrderStatus(base44, body) {
  const orderNumber = String(body?.order_number || '').trim().toUpperCase();
  const guestToken = String(body?.guest_order_token || '').trim();
  if (!/^NV-[A-Z0-9-]{3,64}$/.test(orderNumber) || !isValidGuestSecret(guestToken)) {
    return Response.json({ error: 'invalid_guest_order_lookup' }, { status: 400 });
  }

  const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter({ order_number: orderNumber }, '-created_date', 5);
  const expectedHash = await sha256Hex(guestToken);
  const now = Date.now();
  const tokenMatches = checkoutSessions.some((row) => (
    row?.checkout_data?.guest_checkout === true
      && Number.isFinite(Date.parse(String(row?.expires_at || '')))
      && Date.parse(String(row.expires_at)) > now
      && constantTimeEqual(row?.checkout_data?.guest_order_token_hash, expectedHash)
  ));
  if (!tokenMatches) return Response.json({ error: 'guest_order_not_authorized' }, { status: 403 });

  const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }, '-created_date', 2);
  const order = orders.find((candidate) => (
    candidate?.payment_captured === true || ['paid', 'captured'].includes(String(candidate?.payment_status || '').toLowerCase())
  ));
  if (!order) {
    return Response.json({ ok: true, found: false, order_number: orderNumber, payment_status: 'processing' });
  }
  return Response.json({ ok: true, found: true, order: sanitizeGuestConfirmationOrder(order) });
}

function isWalletConfigurationAdmin(user) {
  return ['admin', 'owner'].includes(String(user?.role || '').trim().toLowerCase());
}

function checkoutProviderSandboxStripe() {
  const secretKey = String(Deno.env.get('STRIPE_SANDBOX_SECRET_KEY') || '').trim();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

function normalizeCheckoutProviderSandboxRequest(body, testId) {
  const normalizedTestId = String(testId || '').trim().toLowerCase();
  const metaCapiTestEnabled = body?.meta_capi_test_enabled === true
    && constantTimeEqual(body?.meta_capi_test_confirmation, META_CAPI_PROVIDER_SANDBOX_CONFIRMATION);
  return {
    ...body,
    customer_email: CHECKOUT_PROVIDER_SANDBOX_RECIPIENT,
    customer_name: 'NuVira Sandbox',
    customer_first_name: 'NuVira',
    customer_last_name: 'Sandbox',
    contact_phone: '6365550100',
    fulfillment_type: 'delivery',
    delivery_address: "619 N Main St, O'Fallon, MO 63366",
    address_line1: '619 N Main St',
    address_line2: '',
    address_city: "O'Fallon",
    address_state: 'MO',
    address_postal_code: '63366',
    points_discount: 0,
    points_used: 0,
    active_reward: null,
    reward_discount: 0,
    credits_discount: 0,
    referral_discount: 0,
    referral_code: null,
    promotion_code: null,
    discount_code: null,
    marketing_measurement_consent: metaCapiTestEnabled ? 'granted' : 'denied',
    meta_capi_test_enabled: metaCapiTestEnabled,
    bag_return_request_id: null,
    guest_checkout: true,
    health_advisory_acknowledged: true,
    health_advisory_version: HEALTH_ADVISORY_VERSION,
    checkout_idempotency_key: `g136-sandbox-checkout-${normalizedTestId}`,
    guest_order_token: `g136-sandbox-order-token-${normalizedTestId}`,
  };
}

function paymentMethodDomainSummary(domainName, record) {
  const googlePayStatus = String(record?.google_pay?.status || 'not_registered').trim().toLowerCase();
  const applePayStatus = String(record?.apple_pay?.status || 'not_registered').trim().toLowerCase();
  const enabled = record?.enabled === true;
  return {
    domain_name: domainName,
    registered: Boolean(record),
    enabled,
    livemode: record?.livemode === true,
    google_pay_status: googlePayStatus,
    apple_pay_status: applePayStatus,
    google_pay_ready: enabled && googlePayStatus === 'active',
  };
}

async function requiredPaymentMethodDomainStatus() {
  const response = await stripe.paymentMethodDomains.list({ limit: 100 });
  const records = Array.isArray(response?.data) ? response.data : [];
  const byName = new Map(records.map((record) => [String(record?.domain_name || '').trim().toLowerCase(), record]));
  const domains = GOOGLE_PAY_REQUIRED_DOMAINS.map((domainName) => (
    paymentMethodDomainSummary(domainName, byName.get(domainName))
  ));
  return {
    required_domain_count: GOOGLE_PAY_REQUIRED_DOMAINS.length,
    google_pay_ready: domains.every((domain) => domain.google_pay_ready),
    domains,
  };
}

async function ensureRequiredPaymentMethodDomains() {
  const response = await stripe.paymentMethodDomains.list({ limit: 100 });
  const records = Array.isArray(response?.data) ? response.data : [];
  const byName = new Map(records.map((record) => [String(record?.domain_name || '').trim().toLowerCase(), record]));

  for (const domainName of GOOGLE_PAY_REQUIRED_DOMAINS) {
    let record = byName.get(domainName);
    if (!record) {
      record = await stripe.paymentMethodDomains.create(
        { domain_name: domainName, enabled: true },
        { idempotencyKey: `nuvira-google-pay-domain-${domainName.replace(/[^a-z0-9]/g, '-')}` },
      );
    } else if (record.enabled !== true) {
      record = await stripe.paymentMethodDomains.update(record.id, { enabled: true });
    }

    if (String(record?.google_pay?.status || '').trim().toLowerCase() !== 'active') {
      await stripe.paymentMethodDomains.validate(record.id);
    }
  }

  return requiredPaymentMethodDomainStatus();
}

function rowUsesDiscountCode(row, code) {
  const normalizedCode = normalizePromotionCode(code);
  if (!normalizedCode) return false;
  if (normalizePromotionCode(row?.promotion_code) === normalizedCode) return true;
  if (normalizePromotionCode(row?.discount_code) === normalizedCode) return true;
  return (Array.isArray(row?.discount_codes) ? row.discount_codes : []).some((value) => (
    normalizePromotionCode(value && typeof value === 'object' ? value.code : value) === normalizedCode
  ));
}

function orderConsumesDiscount(row) {
  if (row?.payment_captured === true) return true;
  const paymentStates = [row?.payment_status, row?.financial_status]
    .map((value) => String(value || '').trim().toLowerCase());
  if (paymentStates.some((value) => ['paid', 'captured', 'partially_refunded', 'refunded'].includes(value))) return true;
  return ['partially_refunded', 'fully_refunded'].includes(String(row?.refund_status || '').trim().toLowerCase());
}

async function customerHasConsumedDiscount(base44, customerEmail, code) {
  const rawEmail = String(customerEmail || '').trim();
  const normalizedEmail = normalizeCustomerEmail(rawEmail);
  if (!normalizedEmail || !normalizePromotionCode(code)) return false;

  const emailCandidates = [...new Set([rawEmail, normalizedEmail].filter(Boolean))];
  const loadRows = async (entity) => {
    const pages = await Promise.all(emailCandidates.map((email) => (
      entity.filter({ customer_email: email }, '-created_date', 200)
    )));
    return pages.flatMap((rows) => Array.isArray(rows) ? rows : []);
  };
  const [nativeOrders, shopifyOrders, approvalRequests] = await Promise.all([
    loadRows(base44.asServiceRole.entities.Order),
    loadRows(base44.asServiceRole.entities.ShopifyOrder),
    loadRows(base44.asServiceRole.entities.DeliveryApprovalRequest),
  ]);

  if ([...nativeOrders, ...shopifyOrders].some((row) => (
    orderConsumesDiscount(row) && rowUsesDiscountCode(row, code)
  ))) return true;

  return approvalRequests.some((row) => (
    rowUsesDiscountCode(row, code) && (
      String(row?.status || '').trim().toLowerCase() === 'captured' ||
      String(row?.stripe_authorization_status || '').trim().toLowerCase() === 'succeeded'
    )
  ));
}

async function oneTimeRedemptionBlock(base44, promotion, customerEmail) {
  if (!promotion?.code || promotion.once_per_customer !== true) return null;
  try {
    if (!await customerHasConsumedDiscount(base44, customerEmail, promotion.code)) return null;
    return Response.json({
      ok: false,
      error_code: 'DISCOUNT_ALREADY_REDEEMED',
      error: 'This one-time welcome offer has already been used on your account.',
    }, { status: 409 });
  } catch (error) {
    console.error(`[PI] One-time discount redemption check failed: ${error.message}`);
    return Response.json({
      ok: false,
      error_code: 'DISCOUNT_REDEMPTION_CHECK_UNAVAILABLE',
      error: 'We could not verify this one-time offer right now. Please try again in a few minutes.',
    }, { status: 503 });
  }
}

async function resolvePromotion(base44, code, eligibleSubtotal, now = new Date()) {
  const normalizedCode = normalizePromotionCode(code);
  const merchandiseSubtotal = Number(eligibleSubtotal);
  if (!Number.isFinite(merchandiseSubtotal) || merchandiseSubtotal < 0) {
    return null;
  }

  if (!normalizedCode) {
    return {
      code: null,
      type: 'promotion',
      label: null,
      discount_type: 'percent',
      percent: 0,
      amount: 0,
      once_per_customer: false,
    };
  }

  const candidates = await base44.asServiceRole.entities.DiscountCode.filter(
    { code: normalizedCode },
    '-created_date',
    5,
  );
  const activeCandidates = candidates.filter((candidate) => candidate.active === true);
  if (activeCandidates.length !== 1) {
    return null;
  }

  const discount = activeCandidates[0];
  const startsAt = discount.starts_at ? new Date(discount.starts_at) : null;
  const endsAt = discount.ends_at ? new Date(discount.ends_at) : null;
  if ((startsAt && (!Number.isFinite(startsAt.getTime()) || now < startsAt)) ||
      (endsAt && (!Number.isFinite(endsAt.getTime()) || now > endsAt))) {
    return null;
  }

  const minimumSubtotal = Number(discount.minimum_subtotal || 0);
  if (!Number.isFinite(minimumSubtotal) || merchandiseSubtotal < minimumSubtotal) {
    return null;
  }

  const discountValue = Number(discount.discount_value);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return null;
  }

  const isFixed = discount.discount_type === 'fixed_amount';
  if (!isFixed && discountValue > 100) {
    return null;
  }

  const uncappedAmount = isFixed
    ? discountValue
    : Math.round(merchandiseSubtotal * discountValue) / 100;
  const maximumDiscount = Number(discount.maximum_discount || 0);
  const cappedAmount = maximumDiscount > 0
    ? Math.min(uncappedAmount, maximumDiscount)
    : uncappedAmount;

  return {
    code: normalizedCode,
    type: discount.discount_kind === 'referral' ? 'referral' : 'promotion',
    label: String(discount.display_name || `${normalizedCode} discount`).trim(),
    discount_type: isFixed ? 'fixed_amount' : 'percent',
    percent: isFixed ? 0 : discountValue,
    amount: Math.min(merchandiseSubtotal, Math.round(cappedAmount * 100) / 100),
    once_per_customer: discount.once_per_customer === true,
  };
}

function normalizeNamePart(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function splitHumanFullName(value) {
  const normalized = normalizeNamePart(value);
  if (!normalized || normalized.includes('@')) return null;
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function resolveCustomerIdentity({
  checkoutFirstName,
  checkoutLastName,
  checkoutCustomerName,
  profile,
  authUser,
}) {
  const requestedFirstName = normalizeNamePart(checkoutFirstName);
  const requestedLastName = normalizeNamePart(checkoutLastName);
  if (requestedFirstName && requestedLastName) {
    return {
      firstName: requestedFirstName,
      lastName: requestedLastName,
      source: 'checkout_structured',
    };
  }

  const profileFirstName = normalizeNamePart(profile?.first_name);
  const profileLastName = normalizeNamePart(profile?.last_name);
  if (profileFirstName && profileLastName) {
    return {
      firstName: profileFirstName,
      lastName: profileLastName,
      source: 'profile_structured',
    };
  }

  const authFirstName = normalizeNamePart(authUser?.first_name);
  const authLastName = normalizeNamePart(authUser?.last_name);
  if (authFirstName && authLastName) {
    return {
      firstName: authFirstName,
      lastName: authLastName,
      source: 'auth_structured',
    };
  }

  const split = splitHumanFullName(checkoutCustomerName);
  if (split) return { ...split, source: 'checkout_full_name' };
  return null;
}

function authorizeCheckoutCustomer(user, customerEmail, guestCheckout) {
  const requested = String(customerEmail || '').trim().toLowerCase();
  const requester = String(user?.email || '').trim().toLowerCase();
  if (!requested || (!user?.email && !guestCheckout)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!user?.email && guestCheckout) return null;
  if (user.role === 'admin' || requester === requested) {
    return null;
  }
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

// ── Inline zone classifier (mirrors validateDeliveryEligibility, no inter-function call needed) ──
const ORIGIN_ADDRESS = "619 N Main St, O'Fallon, MO 63366";
const ZONE_RULES = [
  { zone_key: 'zone_1a_core_0_5',          zone_name: 'Core Delivery',          zone_tier_label: 'Core Delivery',          zone_type: 'core',         min: 0,     max: 5,     delivery_fee: 3.99,  minimum_order: null,  checkout_allowed: true,  manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: 'zone_1b_core_5_10',         zone_name: 'Core Delivery',          zone_tier_label: 'Core Delivery',          zone_type: 'core',         min: 5.01,  max: 10,    delivery_fee: 5.99,  minimum_order: null,  checkout_allowed: true,  manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: 'zone_1c_core_10_15',        zone_name: 'Core Delivery',          zone_tier_label: 'Core Delivery',          zone_type: 'core',         min: 10.01, max: 15,    delivery_fee: 7.99,  minimum_order: null,  checkout_allowed: true,  manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: 'zone_2_extended',           zone_name: 'Extended Delivery',      zone_tier_label: 'Extended Delivery',      zone_type: 'extended',     min: 15.01, max: 25,    delivery_fee: 9.99,  minimum_order: 49.99, checkout_allowed: true,  manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: 'zone_3a_route_review_25_30',zone_name: 'Route Review Zone',      zone_tier_label: 'Route Review Required',  zone_type: 'route_review', min: 25.01, max: 30,    delivery_fee: 12.99, minimum_order: 59.99, checkout_allowed: true,  manual_capture_required: true,  allowed_for_subscriptions: false },
  { zone_key: 'zone_3b_route_review_30_35',zone_name: 'Extended Route Review Zone', zone_tier_label: 'Route Review Required', zone_type: 'route_review', min: 30.01, max: 35, delivery_fee: 15.99, minimum_order: 72.0,  checkout_allowed: true,  manual_capture_required: true,  allowed_for_subscriptions: false },
  { zone_key: 'waitlist_only',             zone_name: 'Delivery Waitlist Area', zone_tier_label: 'Not Yet Available',      zone_type: 'waitlist_only',min: 35.01, max: 99999, delivery_fee: null,  minimum_order: null,  checkout_allowed: false, manual_capture_required: false, allowed_for_subscriptions: false },
];

async function getDeliveryEligibility(address, cartSubtotal, orderType = 'one_time') {
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY not configured');

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?` +
    `origins=${encodeURIComponent(ORIGIN_ADDRESS)}` +
    `&destinations=${encodeURIComponent(address)}` +
    `&units=imperial&key=${apiKey}`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error(`Maps API status: ${data.status}`);

  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== 'OK') throw new Error(`Maps element status: ${element?.status}`);

  const distanceMiles = Math.round((element.distance.value / 1609.344) * 10) / 10;
  const driveTimeMinutes = Math.round(element.duration.value / 60);

  const zone = ZONE_RULES.find(z => distanceMiles >= z.min && distanceMiles <= z.max) || ZONE_RULES[ZONE_RULES.length - 1];
  const minimumMet = !zone.minimum_order || cartSubtotal >= zone.minimum_order;
  const amountNeeded = minimumMet ? 0 : Math.round((zone.minimum_order - cartSubtotal) * 100) / 100;

  let checkoutAllowed = zone.checkout_allowed;
  let reasonCode = 'ELIGIBLE';
  if (!checkoutAllowed) {
    reasonCode = zone.zone_type === 'waitlist_only' ? 'WAITLIST_ONLY' : 'ZONE_BLOCKED';
  } else if (!minimumMet) {
    checkoutAllowed = false;
    reasonCode = 'MINIMUM_ORDER_NOT_MET';
  } else if (!zone.allowed_for_subscriptions && orderType === 'subscription') {
    checkoutAllowed = false;
    reasonCode = 'SUBSCRIPTION_NOT_AVAILABLE_IN_ZONE';
  } else if (zone.zone_type === 'route_review') {
    reasonCode = 'ROUTE_REVIEW_REQUIRED';
  }

  return {
    eligible: checkoutAllowed,
    checkout_allowed: checkoutAllowed,
    zone_key: zone.zone_key,
    zone_name: zone.zone_name,
    zone_type: zone.zone_type,
    delivery_fee: zone.delivery_fee,
    minimum_order: zone.minimum_order,
    minimum_order_met: minimumMet,
    amount_needed: amountNeeded,
    estimated_distance_miles: distanceMiles,
    estimated_drive_time_minutes: driveTimeMinutes,
    distance_confidence: 'driving',
    manual_capture_required: zone.manual_capture_required,
    reason_code: reasonCode,
    customer_message: buildZoneMessage(zone, cartSubtotal, orderType, amountNeeded),
  };
}

function buildZoneMessage(zone, cartSubtotal, orderType, amountNeeded) {
  if (zone.zone_type === 'core') return 'Great news — your address is in our NuVira delivery zone.';
  if (zone.zone_type === 'extended') {
    if (!zone.minimum_order || cartSubtotal >= zone.minimum_order)
      return `Your address is in our extended delivery zone. Extended delivery includes a $${zone.delivery_fee?.toFixed(2)} delivery fee.`;
    return `Your address is in our extended delivery zone. Extended delivery requires a $${zone.minimum_order?.toFixed(2)} minimum order. Add $${amountNeeded?.toFixed(2)} more to continue.`;
  }
  if (zone.zone_type === 'route_review') {
    if (orderType === 'subscription') return "Your address requires route review before we can activate a subscription.";
    return "Your address is outside our automatic delivery routes. We'll place a temporary authorization hold on your card, but you will not be charged unless your request is approved.";
  }
  return "We're not delivering to this address just yet. Join the delivery waitlist and we'll notify you when your area opens.";
}

function getScheduleValue(schedule, canonicalField, legacyField) {
  return schedule?.[canonicalField] || schedule?.[legacyField] || null;
}

function normalizeSchedule(schedule) {
  const productionDate = getScheduleValue(schedule, 'assigned_production_day', 'production_date');
  const deliveryDate = getScheduleValue(schedule, 'assigned_delivery_date', 'delivery_date');
  const windowLabel = schedule?.delivery_window_label || null;
  const windowStart = getScheduleValue(schedule, 'assigned_delivery_window_start', 'delivery_window_start');
  const windowEnd = getScheduleValue(schedule, 'assigned_delivery_window_end', 'delivery_window_end');
  const schedulingReason = schedule?.scheduling_reason || schedule?.schedule_reason || null;

  return {
    productionDate,
    deliveryDate,
    windowLabel,
    windowStart,
    windowEnd,
    deliveryWindowTimezone: schedule?.delivery_window_timezone || schedule?.timezone || 'America/Chicago',
    finalScheduleSource: schedule?.final_schedule_source || 'backend_cadence',
    schedulingReason,
    cutoffWindowLabel: schedule?.cutoff_window_label || null,
    scheduleTimezone: schedule?.schedule_timezone || schedule?.timezone || 'America/Chicago',
  };
}

function isCanonicalSchedule(schedule) {
  const normalized = normalizeSchedule(schedule);
  if (!normalized.productionDate || !normalized.deliveryDate || !normalized.windowLabel || !normalized.windowStart || !normalized.windowEnd) {
    return false;
  }

  const prodDow = new Date(`${normalized.productionDate}T12:00:00`).getDay();
  const delDow = new Date(`${normalized.deliveryDate}T12:00:00`).getDay();
  const label = normalized.windowLabel;
  const isWednesday = prodDow === 2 && delDow === 3 && label === 'Wednesday 5 PM - 8 PM';
  const isSaturday = prodDow === 5 && delDow === 6 && label === 'Saturday 12 PM - 3 PM';
  return isWednesday || isSaturday;
}

async function getLatestScheduleOptions(base44, createdAt) {
  const response = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', {
    mode: 'options',
    created_at: createdAt,
    option_count: 2,
  });
  const payload = response.data || response;
  return Array.isArray(payload?.options) ? payload.options : [];
}

function scheduleFromOption(option) {
  return {
    production_date: option?.production_date || null,
    assigned_production_day: option?.production_date || null,
    delivery_date: option?.delivery_date || null,
    assigned_delivery_date: option?.delivery_date || null,
    delivery_window_label: option?.delivery_window_label || null,
    delivery_window_start: option?.delivery_window_start || null,
    delivery_window_end: option?.delivery_window_end || null,
    assigned_delivery_window_start: option?.delivery_window_start || null,
    assigned_delivery_window_end: option?.delivery_window_end || null,
    delivery_window_timezone: option?.delivery_window_timezone || option?.timezone || 'America/Chicago',
    final_schedule_source: option?.final_schedule_source || 'backend_cadence',
    cutoff_window_label: option?.cutoff_window_label || null,
    schedule_reason: option?.scheduling_reason || null,
    scheduling_reason: option?.scheduling_reason || null,
    schedule_timezone: option?.schedule_timezone || option?.timezone || 'America/Chicago',
    timezone: option?.timezone || 'America/Chicago',
  };
}

function optionMatchesSubmittedFields(option, selectedOption) {
  if (!option || !selectedOption) return false;

  const submittedProductionDate = selectedOption.production_date || selectedOption.assigned_production_day || null;
  const submittedDeliveryDate = selectedOption.delivery_date || selectedOption.assigned_delivery_date || null;
  const submittedWindowStart = selectedOption.delivery_window_start || selectedOption.assigned_delivery_window_start || null;
  const submittedWindowEnd = selectedOption.delivery_window_end || selectedOption.assigned_delivery_window_end || null;

  if (submittedProductionDate && submittedProductionDate !== option.production_date) return false;
  if (submittedDeliveryDate && submittedDeliveryDate !== option.delivery_date) return false;
  if (selectedOption.delivery_window_label && selectedOption.delivery_window_label !== option.delivery_window_label) return false;
  if (submittedWindowStart && submittedWindowStart !== option.delivery_window_start) return false;
  if (submittedWindowEnd && submittedWindowEnd !== option.delivery_window_end) return false;

  return Boolean(
    submittedProductionDate ||
    submittedDeliveryDate ||
    selectedOption.delivery_window_label ||
    submittedWindowStart ||
    submittedWindowEnd
  );
}

function optionConflictsWithSubmittedFields(option, selectedOption) {
  if (!option || !selectedOption) return false;

  const submittedProductionDate = selectedOption.production_date || selectedOption.assigned_production_day || null;
  const submittedDeliveryDate = selectedOption.delivery_date || selectedOption.assigned_delivery_date || null;
  const submittedWindowStart = selectedOption.delivery_window_start || selectedOption.assigned_delivery_window_start || null;
  const submittedWindowEnd = selectedOption.delivery_window_end || selectedOption.assigned_delivery_window_end || null;

  return Boolean(
    (submittedProductionDate && submittedProductionDate !== option.production_date) ||
    (submittedDeliveryDate && submittedDeliveryDate !== option.delivery_date) ||
    (selectedOption.delivery_window_label && selectedOption.delivery_window_label !== option.delivery_window_label) ||
    (submittedWindowStart && submittedWindowStart !== option.delivery_window_start) ||
    (submittedWindowEnd && submittedWindowEnd !== option.delivery_window_end)
  );
}

/**
 * Creates a Stripe PaymentIntent for embedded in-app checkout.
 * Returns { clientSecret, orderNumber, effectiveTotal, ... } — NO redirect URL.
 *
 * A pending Order record is created immediately so the webhook can finalize it
 * on payment_intent.succeeded without needing a CheckoutSession lookup.
 *
 * Metadata preserves the canonical one-time checkout contract.
 */


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const submittedRequestBody = await req.json();
    const authenticatedUser = await base44.auth.me().catch(() => null);
    const sandboxRequested = submittedRequestBody?.internal_sandbox_checkout === true;
    const sandboxTestId = String(submittedRequestBody?.sandbox_test_id || '').trim();
    const internalSandboxCheckout = sandboxRequested
      && isWalletConfigurationAdmin(authenticatedUser)
      && constantTimeEqual(
        submittedRequestBody?.internal_sandbox_confirmation,
        CHECKOUT_PROVIDER_SANDBOX_CONFIRMATION,
      )
      && /^[a-zA-Z0-9._:-]{8,80}$/.test(sandboxTestId);

    if (sandboxRequested && !isWalletConfigurationAdmin(authenticatedUser)) {
      return Response.json({
        ok: false,
        error: 'Admin access is required for the provider sandbox.',
        error_code: 'CHECKOUT_PROVIDER_SANDBOX_FORBIDDEN',
        writes_performed: false,
        provider_calls_performed: false,
      }, { status: 403 });
    }
    if (sandboxRequested && !internalSandboxCheckout) {
      return Response.json({
        ok: false,
        error: 'Exact provider sandbox confirmation and a valid test id are required.',
        error_code: 'CHECKOUT_PROVIDER_SANDBOX_CONFIRMATION_REQUIRED',
        writes_performed: false,
        provider_calls_performed: false,
      }, { status: 400 });
    }
    if (internalSandboxCheckout && !checkoutProviderSandboxStripe()) {
      return Response.json({
        ok: false,
        error: 'Stripe provider sandbox is not configured.',
        error_code: 'CHECKOUT_PROVIDER_SANDBOX_NOT_CONFIGURED',
        writes_performed: false,
        provider_calls_performed: false,
      }, { status: 503 });
    }

    const requestBody = internalSandboxCheckout
      ? normalizeCheckoutProviderSandboxRequest(submittedRequestBody, sandboxTestId)
      : submittedRequestBody;

    const {
      mode, discount_code, discount_contract_version, eligible_subtotal,
      items, subtotal, delivery_fee, total,
      fulfillment_type, delivery_address, contact_phone,
      customer_email, customer_name: checkoutCustomerName,
      customer_first_name: checkoutFirstName,
      customer_last_name: checkoutLastName,
      address_line1, address_line2, address_city, address_state, address_postal_code,
      points_discount, points_used,
      active_reward, reward_discount, credits_discount,
      referral_discount, referral_code,
      promotion_code,
      selected_schedule_option_id, selected_schedule_option,
      selected_delivery_date, assigned_delivery_date, production_date,
      delivery_window_label, delivery_window_start, delivery_window_end,
      delivery_schedule_source,
      guest_checkout, guest_order_token,
      health_advisory_acknowledged, health_advisory_version,
      // Zone eligibility (may be pre-validated by frontend; we re-validate server-side)
      zone_key: clientZoneKey,
      // Client-supplied idempotency key for duplicate-request protection
      checkout_idempotency_key,
      bag_return_request_id,
      analytics_measurement_consent,
      google_measurement_context,
      marketing_measurement_consent,
      meta_capi_test_enabled,
    } = requestBody;
    const isGuestCheckout = internalSandboxCheckout || (!authenticatedUser?.email && guest_checkout === true);

    if (mode === 'guest_order_status') {
      return await readGuestOrderStatus(base44, requestBody);
    }

    if (mode === 'wallet_configuration_status' || mode === 'ensure_google_pay_domains') {
      if (!isWalletConfigurationAdmin(authenticatedUser)) {
        return Response.json({ error: 'forbidden' }, { status: 403 });
      }

      try {
        if (mode === 'ensure_google_pay_domains') {
          if (requestBody.confirmation !== GOOGLE_PAY_DOMAIN_CONFIRMATION) {
            return Response.json({
              ok: false,
              error: 'Explicit Google Pay domain confirmation is required.',
              error_code: 'GOOGLE_PAY_DOMAIN_CONFIRMATION_REQUIRED',
            }, { status: 400 });
          }
          const status = await ensureRequiredPaymentMethodDomains();
          return Response.json({ ok: true, mode, ...status });
        }

        const status = await requiredPaymentMethodDomainStatus();
        return Response.json({ ok: true, mode, ...status });
      } catch (walletError) {
        console.error(`[PI] Google Pay domain readiness failed: ${walletError?.message || 'unknown provider error'}`);
        return Response.json({
          ok: false,
          error: 'Google Pay domain readiness could not be confirmed. Please try again.',
          error_code: 'GOOGLE_PAY_DOMAIN_READINESS_UNAVAILABLE',
        }, { status: 502 });
      }
    }

    if (mode === 'validate_discount_code') {
      const discount = await resolvePromotion(base44, discount_code || promotion_code || referral_code, eligible_subtotal);
      if (!discount?.code || discount.amount <= 0) {
        return Response.json({
          ok: false,
          error_code: 'INVALID_DISCOUNT_CODE',
          error: 'This discount code is not valid for the current order.',
        }, { status: 400 });
      }
      const discountCustomerEmail = normalizeCustomerEmail(customer_email || authenticatedUser?.email);
      if (discount.once_per_customer && !isValidCustomerEmail(discountCustomerEmail)) {
        return Response.json({
          ok: false,
          error_code: 'CUSTOMER_EMAIL_REQUIRED',
          error: 'Enter your email before applying this one-time offer.',
        }, { status: 400 });
      }
      const redemptionBlock = await oneTimeRedemptionBlock(base44, discount, discountCustomerEmail);
      if (redemptionBlock) return redemptionBlock;
      return Response.json({
        ok: true,
        discount: {
          ...discount,
          eligible_subtotal: Math.round(Number(eligible_subtotal) * 100) / 100,
        },
      });
    }

    const normalizedCustomerEmail = normalizeCustomerEmail(customer_email);
    if (!isValidCustomerEmail(normalizedCustomerEmail)) {
      return Response.json({
        error: 'A valid email is required for receipts and delivery updates.',
        error_code: 'CUSTOMER_EMAIL_REQUIRED',
        writes_performed: false,
        payment_intent_created: false,
        order_created: false,
      }, { status: 400 });
    }
    if (isGuestCheckout && (!isValidGuestSecret(guest_order_token) || !isValidGuestSecret(checkout_idempotency_key))) {
      return Response.json({
        error: 'Guest checkout could not be secured. Please refresh and try again.',
        error_code: 'GUEST_CHECKOUT_SECRET_REQUIRED',
        writes_performed: false,
        payment_intent_created: false,
        order_created: false,
      }, { status: 400 });
    }
    if (isGuestCheckout && guestAccountBenefitsRequested(requestBody)) {
      return Response.json({
        error: 'Sign in to use account rewards, credits, or bag returns.',
        error_code: 'GUEST_ACCOUNT_BENEFITS_NOT_ALLOWED',
        writes_performed: false,
        payment_intent_created: false,
        order_created: false,
      }, { status: 403 });
    }
    const unauthorized = authorizeCheckoutCustomer(authenticatedUser, normalizedCustomerEmail, isGuestCheckout);
    if (unauthorized) return unauthorized;
    if (health_advisory_acknowledged !== true || health_advisory_version !== HEALTH_ADVISORY_VERSION) {
      return Response.json({
        error: 'Please acknowledge the current health advisory before placing your order.',
        error_code: 'HEALTH_ADVISORY_ACKNOWLEDGMENT_REQUIRED',
        writes_performed: false,
        payment_intent_created: false,
        order_created: false,
      }, { status: 400 });
    }
    const healthAdvisoryAcknowledgedAt = new Date().toISOString();

    const normalizedPhone = String(contact_phone || '').trim();
    const normalizedAddress = {
      line1: String(address_line1 || '').trim(),
      line2: String(address_line2 || '').trim(),
      city: String(address_city || '').trim(),
      state: String(address_state || '').trim(),
      postalCode: String(address_postal_code || '').trim(),
    };
    const invalidItem = !Array.isArray(items) || items.length === 0 || items.length > 50 || items.some((item) => (
      !String(item?.title || '').trim() ||
      !Number.isFinite(Number(item?.price)) ||
      Number(item?.price) < 0 ||
      !Number.isInteger(Number(item?.quantity)) ||
      Number(item?.quantity) < 1 ||
      Number(item?.quantity) > 100 ||
      invalidProgramCheckoutItem(item)
    ));
    if (invalidItem) {
      return Response.json({
        error: 'Your cart contains an invalid item. Please review it and try again.',
        error_code: 'INVALID_ORDER_ITEMS',
      }, { status: 400 });
    }
    const normalizedItems = isGuestCheckout
      ? await authoritativeGuestCheckoutItems(base44, items)
      : items.map(normalizeCheckoutItem);
    if (!normalizedItems) {
      return Response.json({
        error: 'A product in your cart changed or is unavailable. Please return to your cart and try again.',
        error_code: 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED',
        writes_performed: false,
        payment_intent_created: false,
        order_created: false,
      }, { status: 409 });
    }
    const authoritativeSubtotal = isGuestCheckout
      ? Math.round(normalizedItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0) * 100) / 100
      : Number(subtotal);
    if (normalizedPhone.replace(/\D/g, '').length < 10) {
      return Response.json({
        error: 'A valid phone number is required for fulfillment.',
        error_code: 'CUSTOMER_PHONE_REQUIRED',
      }, { status: 400 });
    }
    if ((fulfillment_type || 'delivery') === 'delivery' && (
      !normalizedAddress.line1 ||
      !normalizedAddress.city ||
      !normalizedAddress.state ||
      !normalizedAddress.postalCode
    )) {
      return Response.json({
        error: 'A complete delivery address is required.',
        error_code: 'DELIVERY_ADDRESS_REQUIRED',
      }, { status: 400 });
    }

    // ── SERVER-SIDE ELIGIBILITY GUARD ────────────────────────────────────────
    // Always re-validate delivery eligibility on the backend before creating a PI.
    let validatedEligibility = null;
    if (fulfillment_type === 'delivery') {
      const addrForCheck = delivery_address ||
        [normalizedAddress.line1, normalizedAddress.city, normalizedAddress.state, normalizedAddress.postalCode].filter(Boolean).join(', ');
      try {
        validatedEligibility = await getDeliveryEligibility(addrForCheck, authoritativeSubtotal || 0, 'one_time');
      } catch (eligErr) {
        console.error(`[PI] Eligibility check failed: ${eligErr.message}`);
        return Response.json({ error: 'Could not verify delivery eligibility. Please try again.' }, { status: 400 });
      }

      console.log(`[PI] Eligibility: zone=${validatedEligibility.zone_key}, checkout_allowed=${validatedEligibility.checkout_allowed}, reason=${validatedEligibility.reason_code}`);

      if (!validatedEligibility.checkout_allowed) {
        return Response.json({
          error: validatedEligibility.customer_message || 'Delivery is not available to this address.',
          reason_code: validatedEligibility.reason_code,
          zone_key: validatedEligibility.zone_key,
          zone_type: validatedEligibility.zone_type,
          amount_needed: validatedEligibility.amount_needed || 0,
        }, { status: 400 });
      }

      // Zone 3 must NOT go through normal PI — it requires manual capture / approval flow
      if (validatedEligibility.zone_type === 'route_review') {
        return Response.json({
          error: validatedEligibility.customer_message,
          reason_code: 'ZONE_3_REQUIRES_APPROVAL_FLOW',
          zone_key: validatedEligibility.zone_key,
          zone_type: validatedEligibility.zone_type,
          requires_approval_flow: true,
        }, { status: 400 });
      }
    }

    let customerProfile = null;
    if (authenticatedUser?.email) {
      try {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: normalizedCustomerEmail });
        customerProfile = profiles[0] || null;
      } catch (err) {
        console.warn(`[PI] Failed to fetch authenticated customer profile: ${err.message}`);
      }
    }

    const customerIdentity = resolveCustomerIdentity({
      checkoutFirstName,
      checkoutLastName,
      checkoutCustomerName,
      profile: customerProfile,
      authUser: authenticatedUser,
    });
    if (!customerIdentity) {
      return Response.json({
        error: 'A first and last name are required for receipts and delivery.',
        error_code: 'CUSTOMER_NAME_REQUIRED',
      }, { status: 400 });
    }
    const customer_name = `${customerIdentity.firstName} ${customerIdentity.lastName}`;

    // Subscription perks
    let subFreeDelivery = false;
    let subDiscountPct  = 0;
    if (authenticatedUser?.email) {
      const subs = await base44.asServiceRole.entities.Subscription.filter({ customer_email: normalizedCustomerEmail, status: 'active' });
      if (subs.length > 0) {
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === subs[0].plan_id);
        if (plan?.discount_percent > 0) {
          subDiscountPct  = plan.discount_percent;
          subFreeDelivery = true;
        }
      }
    }

    const authoritativeDeliveryFee = validatedEligibility
      ? Number(validatedEligibility.delivery_fee || 0)
      : Number(delivery_fee || 0);
    const effectiveDeliveryFee = subFreeDelivery ? 0 : authoritativeDeliveryFee;
    const subDiscountAmt       = subDiscountPct > 0 ? Math.round(authoritativeSubtotal * subDiscountPct) / 100 : 0;
    const usesServerManagedDiscountContract = Number(discount_contract_version || 0) >= 2;
    const legacyReferralAdjustment = !usesServerManagedDiscountContract && !discount_code && referral_code
      ? Number(referral_discount || 0)
      : 0;
    const merchandiseTotalBeforePromotion = isGuestCheckout
      ? authoritativeSubtotal
      : Math.max(0, Number(total) - Number(delivery_fee || 0) + legacyReferralAdjustment);
    const submittedDiscountCode = discount_code || promotion_code || referral_code;
    const promotion = await resolvePromotion(base44, submittedDiscountCode, merchandiseTotalBeforePromotion);
    if (!promotion) {
      return Response.json({
        ok: false,
        error_code: 'INVALID_DISCOUNT_CODE',
        error: 'This discount code is not valid for the current order.',
      }, { status: 400 });
    }
    const redemptionBlock = await oneTimeRedemptionBlock(
      base44,
      promotion,
      normalizedCustomerEmail,
    );
    if (redemptionBlock) return redemptionBlock;
    const promotionDiscountAmt = promotion.type === 'promotion' ? promotion.amount : 0;
    const appliedPromotionDiscountAmt = Math.min(promotionDiscountAmt, merchandiseTotalBeforePromotion);
    const appliedReferralDiscountAmt = promotion.type === 'referral'
      ? Math.min(promotion.amount, merchandiseTotalBeforePromotion)
      : 0;
    const appliedCheckoutCodeDiscount = appliedPromotionDiscountAmt + appliedReferralDiscountAmt;
    const appliedPromotionCode = promotion.type === 'promotion' ? promotion.code : null;
    const appliedReferralCode = promotion.type === 'referral' ? promotion.code : null;
    const totalDiscountAmount  = Math.min(authoritativeSubtotal, Math.round((
      Number(isGuestCheckout ? 0 : points_discount || 0) +
      Number(isGuestCheckout ? 0 : reward_discount || 0) +
      Number(isGuestCheckout ? 0 : credits_discount || 0) +
      subDiscountAmt +
      appliedCheckoutCodeDiscount
    ) * 100) / 100);
    const discountCodes = [
      promotion.code,
    ].filter(Boolean);
    const effectiveTotal = Math.max(
      0,
      merchandiseTotalBeforePromotion - appliedCheckoutCodeDiscount
    ) + effectiveDeliveryFee;

    let orderNumber = internalSandboxCheckout
      ? `NV-SBX-${Date.now().toString(36).toUpperCase()}`
      : `NV-${Date.now().toString(36).toUpperCase()}`;

    // ── CENTRAL SCHEDULE ENGINE ──────────────────────────────────────────
    // Read latest backend options as the single source of truth for checkout dates.
    // Fail closed before creating a PaymentIntent or Order if cadence cannot be confirmed.
    const scheduleCreatedAt = new Date().toISOString();
    let latestOptions = [];
    try {
      latestOptions = await getLatestScheduleOptions(base44, scheduleCreatedAt);
      if (!latestOptions.length) {
        throw new Error('Schedule options response did not include options');
      }

      for (const option of latestOptions) {
        if (!isCanonicalSchedule(scheduleFromOption(option))) {
          throw new Error('Schedule option did not match canonical cadence');
        }
      }
    } catch (schedErr) {
      console.error(`[PI] Schedule calculation failed closed: ${schedErr.message}`);
      return Response.json({ ok: false, error: SCHEDULE_FAILURE_MESSAGE }, { status: 503 });
    }

    const selectedOption = selected_schedule_option || (
      selected_delivery_date || production_date || delivery_window_label || delivery_window_start || delivery_window_end
        ? {
          option_id: selected_schedule_option_id || null,
          production_date,
          delivery_date: selected_delivery_date || assigned_delivery_date,
          delivery_window_label,
          delivery_window_start,
          delivery_window_end,
        }
        : null
    );
    const submittedOptionId = selected_schedule_option_id || selectedOption?.option_id || null;
    let selectedBackendOption;

    if (submittedOptionId) {
      selectedBackendOption = latestOptions.find((option) => option.option_id === submittedOptionId);
      if (selectedBackendOption && optionConflictsWithSubmittedFields(selectedBackendOption, selectedOption)) {
        console.warn(`[PI] Delivery selection conflict: option_id=${submittedOptionId}, selected_delivery_date=${selectedOption?.delivery_date || selected_delivery_date || ''}`);
        selectedBackendOption = null;
      }
    }

    if (!selectedBackendOption && selectedOption) {
      selectedBackendOption = latestOptions.find((option) => optionMatchesSubmittedFields(option, selectedOption));
    }

    if (!selectedBackendOption && !selectedOption) {
      selectedBackendOption = latestOptions.find((option) => option.is_default) || latestOptions[0];
    }

    if (!selectedBackendOption) {
      return Response.json({
        ok: false,
        error_code: 'STALE_DELIVERY_SELECTION',
        message: STALE_DELIVERY_SELECTION_MESSAGE,
        latest_options: latestOptions,
      }, { status: 409 });
    }

    const canonicalSchedule = normalizeSchedule(scheduleFromOption(selectedBackendOption));
    const deliveryDate         = canonicalSchedule.deliveryDate;
    const resolvedProdDate     = canonicalSchedule.productionDate;
    const resolvedWindowLabel  = canonicalSchedule.windowLabel;
    const resolvedWindowStart  = canonicalSchedule.windowStart;
    const resolvedWindowEnd    = canonicalSchedule.windowEnd;
    const resolvedScheduleSrc  = canonicalSchedule.schedulingReason || 'backend cadence';

    const eligibility = validatedEligibility;
    const normalizedGoogleMeasurementContext = analytics_measurement_consent === 'granted'
      ? normalizeGoogleMeasurementContext(google_measurement_context)
      : null;

    // Metadata — centralized schedule fields from calculateNuViraFulfillmentSchedule
    // Keep this provider projection deliberately compact. Stripe accepts at most
    // 50 metadata keys; the complete checkout, eligibility, and audit payloads
    // remain authoritative in CheckoutSession and Order.
    const intentMetadata = {
      checkout_version:         '3.0_embedded',
      checkout_mode:            isGuestCheckout ? 'guest' : 'account',
      order_number:             orderNumber,
      is_preorder:              'false',
      customer_email:           normalizedCustomerEmail,
      customer_name:            customer_name  || '',
      customer_phone:           normalizedPhone,
      delivery_method:          fulfillment_type || 'delivery',
      delivery_address_line1:   normalizedAddress.line1,
      delivery_address_line2:   normalizedAddress.line2,
      delivery_city:            normalizedAddress.city,
      delivery_state:           normalizedAddress.state,
      delivery_postal_code:     normalizedAddress.postalCode,
      selected_delivery_date:   deliveryDate,
      assigned_production_day:  resolvedProdDate,
      delivery_window_label:    resolvedWindowLabel,
      delivery_window_start:    resolvedWindowStart,
      delivery_window_end:      resolvedWindowEnd,
      final_schedule_source:    canonicalSchedule.finalScheduleSource,
      cutoff_window_label:      canonicalSchedule.cutoffWindowLabel || '',
      delivery_window_timezone: canonicalSchedule.deliveryWindowTimezone,
      schedule_timezone:        canonicalSchedule.scheduleTimezone,
      // Zone eligibility fields
      delivery_zone_key:        eligibility?.zone_key        || '',
      delivery_zone_name:       eligibility?.zone_name       || '',
      delivery_zone_type:       eligibility?.zone_type       || '',
      delivery_zone_fee:        eligibility ? String(eligibility.delivery_fee ?? '') : '',
      delivery_zone_minimum:    eligibility ? String(eligibility.minimum_order  ?? '') : '',
      estimated_distance_miles: eligibility ? String(eligibility.estimated_distance_miles ?? '') : '',
      distance_confidence:      eligibility?.distance_confidence || '',
      eligibility_reason_code:  eligibility?.reason_code     || '',
      referral_code:            appliedReferralCode || '',
      referral_discount_amount: appliedReferralDiscountAmt.toFixed(2),
      promotion_code:           appliedPromotionCode || '',
      promotion_discount_percent: String(promotion.percent || 0),
      promotion_discount_amount:  appliedPromotionDiscountAmt.toFixed(2),
      total_discount_amount:      totalDiscountAmount.toFixed(2),
      discount_codes:             discountCodes.join(','),
      bag_return_request_id:      isGuestCheckout ? '' : String(bag_return_request_id || '').trim(),
      health_advisory_acknowledged: 'true',
      health_advisory_acknowledged_at: healthAdvisoryAcknowledgedAt,
      health_advisory_version:    HEALTH_ADVISORY_VERSION,
      internal_sandbox_checkout:  internalSandboxCheckout ? 'true' : 'false',
      is_test_order:              internalSandboxCheckout ? 'true' : 'false',
      sandbox_test_id:            internalSandboxCheckout ? sandboxTestId : '',
      marketing_measurement_consent: marketing_measurement_consent === 'granted' ? 'granted' : 'denied',
      meta_capi_test_enabled:      internalSandboxCheckout && meta_capi_test_enabled === true ? 'true' : 'false',
    };

    if (Object.keys(intentMetadata).length > 50) {
      throw new Error('CHECKOUT_PROVIDER_METADATA_LIMIT_EXCEEDED');
    }

    // Account discounts are represented in the pre-code total. The checkout
    // code is resolved and subtracted exactly once on the server above.
    const amountCents = Math.max(50, Math.round(effectiveTotal * 100));

    // Build Stripe idempotency key from the client-supplied checkout key (if present).
    // This ensures duplicate calls from retries or double-taps return the same PI.
    const stripeIdempotencyKey = checkout_idempotency_key
      ? isGuestCheckout
        ? `nv-pi-guest-${(await sha256Hex(`${normalizedCustomerEmail}:${checkout_idempotency_key}`)).slice(0, 48)}`
        : `nv-pi-${checkout_idempotency_key}`
      : undefined;

    // Create PaymentIntent with card only.
    // payment_method_types:['card'] enables Apple Pay and Google Pay via ExpressCheckoutElement
    // without opening the door to Bank, Klarna, ACH, or any redirect-based method.
    // automatic_payment_methods is intentionally omitted to prevent Bank from appearing.
    const checkoutStripe = internalSandboxCheckout ? checkoutProviderSandboxStripe() : stripe;
    const paymentIntent = await checkoutStripe.paymentIntents.create(
      {
        amount:   amountCents,
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: intentMetadata,
        receipt_email: normalizedCustomerEmail,
        shipping: fulfillment_type === 'delivery' ? {
          name: customer_name,
          phone: normalizedPhone,
          address: {
            line1: normalizedAddress.line1,
            line2: normalizedAddress.line2 || undefined,
            city: normalizedAddress.city,
            state: normalizedAddress.state,
            postal_code: normalizedAddress.postalCode,
            country: 'US',
          },
        } : undefined,
        description: internalSandboxCheckout
          ? `NuVira provider sandbox ${orderNumber}`
          : `NuVira Order ${orderNumber}`,
      },
      stripeIdempotencyKey ? { idempotencyKey: stripeIdempotencyKey } : {}
    );

    if (internalSandboxCheckout && paymentIntent.metadata?.order_number) {
      orderNumber = paymentIntent.metadata.order_number;
    }

    console.log(`[PI] Created PI ${paymentIntent.id} for ${orderNumber}: payment_method_types=card; express_wallets=apple_pay,google_pay. amount=${amountCents}¢, checkout_mode=${isGuestCheckout ? 'guest' : 'account'}`);

    // Pre-create a pending Order so webhook finalize is simple and idempotent
    const resolvedDeliveryAddress = delivery_address || [
      normalizedAddress.line1,
      normalizedAddress.city,
      normalizedAddress.state,
      normalizedAddress.postalCode,
    ].filter(Boolean).join(', ');
    let sandboxOrderReady = !internalSandboxCheckout;
    let sandboxSessionReady = !internalSandboxCheckout;

    try {
      // Deduplication guard: if a retry call hit Stripe idempotency and returned the same PI,
      // check whether a pending Order already exists for this PI before creating another.
      if (stripeIdempotencyKey) {
        const existingOrders = await base44.asServiceRole.entities.Order.filter({
          stripe_payment_intent_id: paymentIntent.id,
        });
        if (existingOrders.length > 0) {
          const existing = existingOrders[0];
          console.log(`[PI] Idempotent retry — returning existing pending Order ${existing.order_number} for PI ${paymentIntent.id}`);
          if (internalSandboxCheckout) {
            sandboxOrderReady = existing.is_test_order === true
              && existing.source_type === 'guest_sandbox'
              && existing.customer_email === CHECKOUT_PROVIDER_SANDBOX_RECIPIENT;
          } else {
          return Response.json({
            clientSecret:         paymentIntent.client_secret,
            paymentIntentId:      paymentIntent.id,
            publishableKey:       internalSandboxCheckout
              ? Deno.env.get('STRIPE_SANDBOX_PUBLISHABLE_KEY')
              : Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
            orderNumber:          existing.order_number,
            effectiveTotal,
            effectiveDeliveryFee,
            subFreeDelivery,
            subDiscountPct,
            subDiscountAmt,
            discountCode:       promotion.code,
            discountType:       promotion.type,
            discountLabel:      promotion.label,
            discountAmount:     appliedCheckoutCodeDiscount,
            promotionCode:      appliedPromotionCode,
            promotionDiscountPercent: promotion.percent,
            promotionDiscountAmount: appliedPromotionDiscountAmt,
            idempotent_replay:    true,
            confirmedDeliverySchedule: {
              delivery_date:         deliveryDate,
              production_date:       resolvedProdDate,
              delivery_window_label: resolvedWindowLabel,
              delivery_window_start: resolvedWindowStart,
              delivery_window_end:   resolvedWindowEnd,
              final_schedule_source: canonicalSchedule.finalScheduleSource,
            },
          });
          }
        }
      }

      if (!sandboxOrderReady) {
        await base44.asServiceRole.entities.Order.create({
        order_number:             orderNumber,
        customer_email:           normalizedCustomerEmail,
        customer_name,
        items: normalizedItems,
        subtotal:                 authoritativeSubtotal,
        delivery_fee:             effectiveDeliveryFee,
        total:                    effectiveTotal,
        fulfillment_type:         fulfillment_type || 'delivery',
        delivery_address:         resolvedDeliveryAddress,
        address_line1:            normalizedAddress.line1,
        address_line2:            normalizedAddress.line2,
        address_city:             normalizedAddress.city,
        address_state:            normalizedAddress.state,
        address_postal_code:      normalizedAddress.postalCode,
        address_country:          'US',
        contact_phone:            normalizedPhone,
        estimated_delivery_date:  deliveryDate,
        assigned_delivery_date:   deliveryDate,
        assigned_production_day:  resolvedProdDate,
        production_date:          resolvedProdDate,
        delivery_window_label:    resolvedWindowLabel,
        assigned_delivery_window_start: resolvedWindowStart,
        assigned_delivery_window_end:   resolvedWindowEnd,
        delivery_window_timezone: canonicalSchedule.deliveryWindowTimezone,
        final_schedule_source:    canonicalSchedule.finalScheduleSource,
        scheduling_reason:        resolvedScheduleSrc,
        schedule_timezone:        canonicalSchedule.scheduleTimezone,
        cutoff_window_label:      canonicalSchedule.cutoffWindowLabel || '',
        // CRITICAL: pending_payment is NOT an operational status.
        // This order must NOT sync to Hub, appear in Driver Portal, route optimization,
        // production, or Order Management active views until payment_intent.succeeded fires.
        status:                   'pending_payment',
        payment_status:           'pending',
        financial_status:         'pending',
        payment_captured:         false,
        stripe_payment_intent_id: paymentIntent.id,
        referral_code:            appliedReferralCode,
        promotion_code:           appliedPromotionCode,
        promotion_discount_percent: promotion.percent,
        promotion_discount_amount: appliedPromotionDiscountAmt,
        total_discounts:          totalDiscountAmount,
        discount_codes:           discountCodes,
        is_preorder:              false,
        source_type:              internalSandboxCheckout
          ? 'guest_sandbox'
          : isGuestCheckout ? 'guest_one_time' : 'one_time',
        is_test_order:            internalSandboxCheckout,
        health_advisory_acknowledged: true,
        health_advisory_acknowledged_at: healthAdvisoryAcknowledgedAt,
        health_advisory_version:  HEALTH_ADVISORY_VERSION,
        // Zone eligibility fields
        ...(eligibility ? {
          delivery_zone_id:         eligibility.zone_key || '',
        } : {}),
        status_history: [{
          status:    'pending_payment',
          timestamp: new Date().toISOString(),
          message:   'Order created — awaiting payment confirmation.',
        }],
        });
        sandboxOrderReady = internalSandboxCheckout;
      }
      console.log(`[PI] Pending Order ${orderNumber} pre-created`);
    } catch (orderErr) {
      // Non-fatal — webhook will create order if this fails
      console.error(`[PI] Failed to pre-create Order ${orderNumber}: ${orderErr.message}`);
    }

    // Also store CheckoutSession for legacy compatibility / admin tools
    try {
      if (internalSandboxCheckout) {
        const existingSessions = await base44.asServiceRole.entities.CheckoutSession.filter({
          stripe_session_id: paymentIntent.id,
        }, '-created_date', 2);
        sandboxSessionReady = existingSessions.some((candidate) => (
          candidate?.checkout_data?.internal_sandbox_checkout === true
            && candidate?.checkout_data?.sandbox_test_id === sandboxTestId
            && candidate?.customer_email === CHECKOUT_PROVIDER_SANDBOX_RECIPIENT
        ));
      }
      if (!sandboxSessionReady) {
        await base44.asServiceRole.entities.CheckoutSession.create({
        stripe_session_id: paymentIntent.id, // re-use field for PI ID
        order_number:      orderNumber,
        customer_email:    normalizedCustomerEmail,
        checkout_data: {
          order_number: orderNumber,
          customer_email: normalizedCustomerEmail,
          customer_name,
          customer_first_name: customerIdentity.firstName,
          customer_last_name: customerIdentity.lastName,
          customer_name_source: customerIdentity.source,
          checkout_idempotency_key: checkout_idempotency_key || null,
          bag_return_request_id: bag_return_request_id || null,
          address_line1: normalizedAddress.line1,
          address_line2: normalizedAddress.line2,
          address_city: normalizedAddress.city,
          address_state: normalizedAddress.state,
          address_postal_code: normalizedAddress.postalCode,
          address_country: 'US',
          items: normalizedItems, subtotal: authoritativeSubtotal,
          delivery_fee:              effectiveDeliveryFee,
          total:                     effectiveTotal,
          fulfillment_type:          fulfillment_type || 'delivery',
          delivery_address:          resolvedDeliveryAddress,
          contact_phone:             normalizedPhone,
          estimated_delivery_date:   deliveryDate,
          assigned_delivery_date:    deliveryDate,
          assigned_production_day:   resolvedProdDate,
          production_date:           resolvedProdDate || null,
          delivery_window_label:     resolvedWindowLabel,
          delivery_window_start:     resolvedWindowStart,
          delivery_window_end:       resolvedWindowEnd,
          assigned_delivery_window_start: resolvedWindowStart,
          assigned_delivery_window_end:   resolvedWindowEnd,
          delivery_window_timezone:  canonicalSchedule.deliveryWindowTimezone,
          delivery_schedule_source:  canonicalSchedule.finalScheduleSource,
          final_schedule_source:     canonicalSchedule.finalScheduleSource,
          scheduling_reason:         resolvedScheduleSrc,
          cutoff_window_label:       canonicalSchedule.cutoffWindowLabel || '',
          schedule_timezone:         canonicalSchedule.scheduleTimezone,
          is_preorder:               false,
          referral_code:             appliedReferralCode,
          referral_discount:         appliedReferralDiscountAmt,
          promotion_code:            appliedPromotionCode,
          promotion_discount_percent: promotion.percent,
          promotion_discount_amount: appliedPromotionDiscountAmt,
          total_discounts:           totalDiscountAmount,
          discount_codes:            discountCodes,
          points_used:               isGuestCheckout ? 0 : points_used || 0,
          points_discount:           isGuestCheckout ? 0 : points_discount || 0,
          active_reward:             isGuestCheckout ? null : active_reward || null,
          reward_discount:           isGuestCheckout ? 0 : reward_discount || 0,
          credits_discount:          isGuestCheckout ? 0 : credits_discount || 0,
          guest_checkout:            isGuestCheckout,
          guest_order_token_hash:    isGuestCheckout ? await sha256Hex(guest_order_token) : null,
          internal_sandbox_checkout: internalSandboxCheckout,
          sandbox_test_id:           internalSandboxCheckout ? sandboxTestId : null,
          analytics_measurement_consent: analytics_measurement_consent === 'granted' ? 'granted' : 'denied',
          google_measurement_context: normalizedGoogleMeasurementContext,
          marketing_measurement_consent: marketing_measurement_consent === 'granted' ? 'granted' : 'denied',
          meta_capi_test_enabled:     internalSandboxCheckout && meta_capi_test_enabled === true,
          health_advisory_acknowledged: true,
          health_advisory_acknowledged_at: healthAdvisoryAcknowledgedAt,
          health_advisory_version:    HEALTH_ADVISORY_VERSION,
        },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        sandboxSessionReady = internalSandboxCheckout;
      }
    } catch (csErr) {
      console.warn(`[PI] Failed to store CheckoutSession for ${orderNumber}: ${csErr.message}`);
    }

    if (internalSandboxCheckout) {
      if (!sandboxOrderReady || !sandboxSessionReady) {
        return Response.json({
          ok: false,
          sandbox: true,
          no_money_moved: true,
          sandbox_test_id: sandboxTestId,
          orderNumber,
          paymentIntentId: paymentIntent.id,
          error: 'The isolated sandbox records were not ready, so payment confirmation was not attempted.',
          error_code: 'CHECKOUT_PROVIDER_SANDBOX_RECORDS_NOT_READY',
          provider_call_performed: true,
          payment_confirmation_attempted: false,
          production_stripe_key_used: false,
          customer_communications_sent: false,
        }, { status: 503 });
      }
      try {
        const confirmed = paymentIntent.status === 'succeeded'
          ? paymentIntent
          : await checkoutStripe.paymentIntents.confirm(paymentIntent.id, {
            payment_method: 'pm_card_visa',
          });
        return Response.json({
          ok: true,
          sandbox: true,
          no_money_moved: true,
          sandbox_test_id: sandboxTestId,
          orderNumber,
          paymentIntentId: confirmed.id,
          payment_status: confirmed.status,
          provider_call_performed: true,
          production_stripe_key_used: false,
          customer_communications_sent_directly: false,
          safe_test_recipient: CHECKOUT_PROVIDER_SANDBOX_RECIPIENT,
        });
      } catch (sandboxError) {
        console.error(`[PI sandbox] Test PaymentIntent confirmation failed for ${orderNumber}: ${sandboxError?.message || 'unknown provider error'}`);
        return Response.json({
          ok: false,
          sandbox: true,
          no_money_moved: true,
          sandbox_test_id: sandboxTestId,
          orderNumber,
          paymentIntentId: paymentIntent.id,
          error: 'Stripe sandbox payment confirmation failed.',
          error_code: 'CHECKOUT_PROVIDER_SANDBOX_CONFIRMATION_FAILED',
          provider_call_performed: true,
          production_stripe_key_used: false,
          customer_communications_sent_directly: false,
        }, { status: 502 });
      }
    }

    return Response.json({
      clientSecret:         paymentIntent.client_secret,
      paymentIntentId:      paymentIntent.id,
      publishableKey:       Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
      orderNumber,
      effectiveTotal,
      effectiveDeliveryFee,
      subFreeDelivery,
      subDiscountPct,
      subDiscountAmt,
      discountCode:       promotion.code,
      discountType:       promotion.type,
      discountLabel:      promotion.label,
      discountAmount:     appliedCheckoutCodeDiscount,
      promotionCode:      appliedPromotionCode,
      promotionDiscountPercent: promotion.percent,
      promotionDiscountAmount: appliedPromotionDiscountAmt,
      totalDiscountAmount,
      discountCodes,
      confirmedDeliverySchedule: {
        delivery_date: deliveryDate,
        production_date: resolvedProdDate,
        delivery_window_label: resolvedWindowLabel,
        delivery_window_start: resolvedWindowStart,
        delivery_window_end: resolvedWindowEnd,
        final_schedule_source: canonicalSchedule.finalScheduleSource,
      },
    });

  } catch (error) {
    console.error('[PI] createPaymentIntent error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
