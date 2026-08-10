import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const SCHEDULE_FAILURE_MESSAGE = 'We’re having trouble confirming your delivery window right now. Please try again in a few minutes or contact NuVira support.';
const STALE_DELIVERY_SELECTION_MESSAGE = 'That delivery window is no longer available. Please select a new delivery window.';
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

async function authorizeCheckoutCustomer(base44, customerEmail) {
  const user = await base44.auth.me().catch(() => null);
  const requested = String(customerEmail || '').trim().toLowerCase();
  const requester = String(user?.email || '').trim().toLowerCase();
  if (!user?.email || !requested) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
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
    const requestBody = await req.json();

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
      // Zone eligibility (may be pre-validated by frontend; we re-validate server-side)
      zone_key: clientZoneKey,
      // Client-supplied idempotency key for duplicate-request protection
      checkout_idempotency_key,
      bag_return_request_id,
    } = requestBody;
    const authenticatedUser = await base44.auth.me().catch(() => null);
    if (!authenticatedUser?.email) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
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
      const redemptionBlock = await oneTimeRedemptionBlock(base44, discount, authenticatedUser.email);
      if (redemptionBlock) return redemptionBlock;
      return Response.json({
        ok: true,
        discount: {
          ...discount,
          eligible_subtotal: Math.round(Number(eligible_subtotal) * 100) / 100,
        },
      });
    }

    const unauthorized = await authorizeCheckoutCustomer(base44, customer_email);
    if (unauthorized) return unauthorized;

    const normalizedPhone = String(contact_phone || '').trim();
    const normalizedAddress = {
      line1: String(address_line1 || '').trim(),
      line2: String(address_line2 || '').trim(),
      city: String(address_city || '').trim(),
      state: String(address_state || '').trim(),
      postalCode: String(address_postal_code || '').trim(),
    };
    const invalidItem = !Array.isArray(items) || items.length === 0 || items.some((item) => (
      !String(item?.title || '').trim() ||
      !Number.isFinite(Number(item?.price)) ||
      Number(item?.price) < 0 ||
      !Number.isInteger(Number(item?.quantity)) ||
      Number(item?.quantity) < 1 ||
      invalidProgramCheckoutItem(item)
    ));
    if (invalidItem) {
      return Response.json({
        error: 'Your cart contains an invalid item. Please review it and try again.',
        error_code: 'INVALID_ORDER_ITEMS',
      }, { status: 400 });
    }
    const normalizedItems = items.map(normalizeCheckoutItem);
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
        validatedEligibility = await getDeliveryEligibility(addrForCheck, subtotal || 0, 'one_time');
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
    if (customer_email) {
      try {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
        customerProfile = profiles[0] || null;
      } catch (err) {
        console.warn(`[PI] Failed to fetch UserProfile for ${customer_email}: ${err.message}`);
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
    if (customer_email) {
      const subs = await base44.asServiceRole.entities.Subscription.filter({ customer_email, status: 'active' });
      if (subs.length > 0) {
        const allPlans = await base44.asServiceRole.entities.SubscriptionPlan.list();
        const plan = allPlans.find(p => p.id === subs[0].plan_id);
        if (plan?.discount_percent > 0) {
          subDiscountPct  = plan.discount_percent;
          subFreeDelivery = true;
        }
      }
    }

    const effectiveDeliveryFee = subFreeDelivery ? 0 : (delivery_fee || 0);
    const subDiscountAmt       = subDiscountPct > 0 ? Math.round(subtotal * subDiscountPct) / 100 : 0;
    const usesServerManagedDiscountContract = Number(discount_contract_version || 0) >= 2;
    const legacyReferralAdjustment = !usesServerManagedDiscountContract && !discount_code && referral_code
      ? Number(referral_discount || 0)
      : 0;
    const merchandiseTotalBeforePromotion = Math.max(
      0,
      Number(total) - Number(delivery_fee || 0) + legacyReferralAdjustment,
    );
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
      customer_email || authenticatedUser.email,
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
    const totalDiscountAmount  = Math.min(Number(subtotal), Math.round((
      Number(points_discount || 0) +
      Number(reward_discount || 0) +
      Number(credits_discount || 0) +
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

    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;

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

    // Metadata — centralized schedule fields from calculateNuViraFulfillmentSchedule
    const intentMetadata = {
      base44_app_id:            Deno.env.get('BASE44_APP_ID'),
      source_app:               'customer_app',
      checkout_version:         '3.0_embedded',
      order_number:             orderNumber,
      order_type:               'one_time',
      fulfillment_mode:         'single_delivery',
      is_preorder:              'false',
      customer_email:           customer_email || '',
      customer_name:            customer_name  || '',
      customer_first_name:      customerIdentity.firstName,
      customer_last_name:       customerIdentity.lastName,
      customer_name_source:     customerIdentity.source,
      customer_phone:           normalizedPhone,
      delivery_method:          fulfillment_type || 'delivery',
      delivery_address_line1:   normalizedAddress.line1,
      delivery_address_line2:   normalizedAddress.line2,
      delivery_city:            normalizedAddress.city,
      delivery_state:           normalizedAddress.state,
      delivery_postal_code:     normalizedAddress.postalCode,
      requested_delivery_date:  deliveryDate,
      selected_delivery_date:   deliveryDate,
      production_date:          resolvedProdDate,
      assigned_production_day:  resolvedProdDate,
      delivery_window_label:    resolvedWindowLabel,
      delivery_window_start:    resolvedWindowStart,
      delivery_window_end:      resolvedWindowEnd,
      schedule_reason:          resolvedScheduleSrc,
      scheduling_reason:        resolvedScheduleSrc,
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
      zone_origin_address:      "619 N Main St, O'Fallon, MO 63366",
      eligibility_reason_code:  eligibility?.reason_code     || '',
      referral_code:            appliedReferralCode || '',
      referral_discount_amount: appliedReferralDiscountAmt.toFixed(2),
      promotion_code:           appliedPromotionCode || '',
      promotion_discount_percent: String(promotion.percent || 0),
      promotion_discount_amount:  appliedPromotionDiscountAmt.toFixed(2),
      total_discount_amount:      totalDiscountAmount.toFixed(2),
      discount_codes:             discountCodes.join(','),
      bag_return_request_id:      String(bag_return_request_id || '').trim(),
    };

    // Account discounts are represented in the pre-code total. The checkout
    // code is resolved and subtracted exactly once on the server above.
    const amountCents = Math.max(50, Math.round(effectiveTotal * 100));

    // Build Stripe idempotency key from the client-supplied checkout key (if present).
    // This ensures duplicate calls from retries or double-taps return the same PI.
    const stripeIdempotencyKey = checkout_idempotency_key
      ? `nv-pi-${checkout_idempotency_key}`
      : undefined;

    // Create PaymentIntent with card only.
    // payment_method_types:['card'] enables Apple Pay and Google Pay via ExpressCheckoutElement
    // without opening the door to Bank, Klarna, ACH, or any redirect-based method.
    // automatic_payment_methods is intentionally omitted to prevent Bank from appearing.
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount:   amountCents,
        currency: 'usd',
        payment_method_types: ['card'],
        metadata: intentMetadata,
        receipt_email: customer_email || undefined,
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
        description: `NuVira Order ${orderNumber}`,
      },
      stripeIdempotencyKey ? { idempotencyKey: stripeIdempotencyKey } : {}
    );

    console.log(`[PI] Created PI ${paymentIntent.id} for ${orderNumber}: automatic_payment_methods=enabled, allow_redirects=never. amount=${amountCents}¢, customer=${customer_email}`);

    // Pre-create a pending Order so webhook finalize is simple and idempotent
    const resolvedDeliveryAddress = delivery_address || [
      normalizedAddress.line1,
      normalizedAddress.city,
      normalizedAddress.state,
      normalizedAddress.postalCode,
    ].filter(Boolean).join(', ');

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
          return Response.json({
            clientSecret:         paymentIntent.client_secret,
            paymentIntentId:      paymentIntent.id,
            publishableKey:       Deno.env.get('STRIPE_PUBLISHABLE_KEY'),
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

      await base44.asServiceRole.entities.Order.create({
        order_number:             orderNumber,
        customer_email:           customer_email || '',
        customer_name,
        items: normalizedItems,
        subtotal,
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
      console.log(`[PI] Pending Order ${orderNumber} pre-created`);
    } catch (orderErr) {
      // Non-fatal — webhook will create order if this fails
      console.error(`[PI] Failed to pre-create Order ${orderNumber}: ${orderErr.message}`);
    }

    // Also store CheckoutSession for legacy compatibility / admin tools
    try {
      await base44.asServiceRole.entities.CheckoutSession.create({
        stripe_session_id: paymentIntent.id, // re-use field for PI ID
        order_number:      orderNumber,
        customer_email:    customer_email || '',
        checkout_data: {
          order_number: orderNumber,
          customer_email,
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
          items: normalizedItems, subtotal,
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
          points_used:               points_used    || 0,
          points_discount:           points_discount|| 0,
          active_reward:             active_reward  || null,
          reward_discount:           reward_discount|| 0,
          credits_discount:          credits_discount || 0,
        },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (csErr) {
      console.warn(`[PI] Failed to store CheckoutSession for ${orderNumber}: ${csErr.message}`);
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
