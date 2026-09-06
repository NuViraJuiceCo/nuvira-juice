// base44/functions/getCustomerAccountDashboardData/handlers/addressSuggest/entry.ts
import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";
async function readJsonBody(req) {
  try {
    const raw = await req.text();
    if (!raw || raw.trim() === "") return { ok: true, body: {} };
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: Response.json({ error: "malformed_json" }, { status: 400 }) };
  }
}
async function handler(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const { query } = parsed.body || {};
    if (!query || query.length < 3) {
      return Response.json({ suggestions: [] });
    }
    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "Google Maps API key not configured" }, { status: 500 });
    }
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&components=country:us&location=38.8106,-90.6998&radius=40000&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Places API error:", data.status, data.error_message);
      return Response.json({ suggestions: [] });
    }
    const suggestions = await Promise.all(
      (data.predictions || []).slice(0, 5).map(async (prediction) => {
        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${prediction.place_id}&fields=address_components&key=${apiKey}`;
        const detailRes = await fetch(detailUrl);
        const detailData = await detailRes.json();
        const components = detailData.result?.address_components || [];
        const get = (type) => components.find((c) => c.types.includes(type))?.long_name || "";
        const getShort = (type) => components.find((c) => c.types.includes(type))?.short_name || "";
        const streetNumber = get("street_number");
        const route = get("route");
        const street = [streetNumber, route].filter(Boolean).join(" ");
        const city = get("locality") || get("sublocality") || get("administrative_area_level_3");
        const state = getShort("administrative_area_level_1");
        const zip = get("postal_code");
        return { street, city, state, zip, display: prediction.description };
      })
    );
    return Response.json({ suggestions });
  } catch (error) {
    console.error("Address suggest error:", error);
    return Response.json({ suggestions: [] });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/cancelSubscriptionFutureRenewal/entry.ts
import { createClientFromRequest as createClientFromRequest2 } from "npm:@base44/sdk@0.8.25";
import Stripe from "npm:stripe@14.21.0";
var stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"));
async function handler2(req) {
  try {
    const base44 = createClientFromRequest2(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const { subscription_id } = body;
    if (!subscription_id) {
      return Response.json({ error: "Missing subscription_id" }, { status: 400 });
    }
    const subs = await base44.entities.Subscription.filter({ id: subscription_id });
    if (!subs || subs.length === 0 || subs[0].customer_email !== user.email) {
      return Response.json({ error: "Subscription not found" }, { status: 404 });
    }
    const sub = subs[0];
    if (sub.status === "cancelled") {
      return Response.json({ error: "Subscription is already cancelled" }, { status: 400 });
    }
    const stripeSubId = sub.stripe_subscription_id;
    let periodEnd = null;
    if (stripeSubId) {
      try {
        const stripeSub = await stripe.subscriptions.update(stripeSubId, {
          cancel_at_period_end: true
        });
        periodEnd = stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1e3).toISOString().split("T")[0] : null;
        console.log(`[cancelFutureRenewal] Stripe sub ${stripeSubId} set to cancel_at_period_end=true. Period ends: ${periodEnd}`);
      } catch (stripeErr) {
        console.error(`[cancelFutureRenewal] Stripe update failed: ${stripeErr.message}`);
      }
    } else {
      console.warn(`[cancelFutureRenewal] No stripe_subscription_id on sub ${subscription_id} \u2014 skipping Stripe update`);
    }
    await base44.asServiceRole.entities.Subscription.update(subscription_id, {
      cancel_at_period_end: true,
      cancel_effective_date: periodEnd
    });
    console.log(`[cancelFutureRenewal] CA Subscription ${subscription_id} marked cancel_at_period_end=true`);
    return Response.json({
      success: true,
      cancel_at_period_end: true,
      effective_date: periodEnd,
      message: periodEnd ? `Your subscription will remain active until ${new Date(periodEnd).toLocaleDateString()}. You will still receive all scheduled deliveries for your current paid month.` : "Your subscription renewal has been cancelled. You will still receive your current month's deliveries."
    });
  } catch (error) {
    console.error("[cancelFutureRenewal] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/claimReward/entry.ts
import { createClientFromRequest as createClientFromRequest3 } from "npm:@base44/sdk@0.8.25";
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
async function handler3(req) {
  try {
    const base44 = createClientFromRequest3(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { email: email3, reward_id, reward_title, reward_type } = await req.json();
    if (!email3 || !reward_id || !reward_title) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    const authenticatedEmail = normalizeEmail(user.email);
    const requestedEmail = normalizeEmail(email3);
    if (!authenticatedEmail || requestedEmail !== authenticatedEmail) {
      return Response.json({ error: "Cannot claim a reward for another customer" }, { status: 403 });
    }
    const rewardRows = await base44.asServiceRole.entities.RewardTier.filter({
      id: reward_id,
      is_active: true
    }, void 0, 1);
    const reward = rewardRows[0];
    if (!reward) {
      return Response.json({ error: "Reward is unavailable" }, { status: 404 });
    }
    if (String(reward.title || "") !== String(reward_title || "") || String(reward.reward_type || "") !== String(reward_type || "")) {
      return Response.json({ error: "Reward details do not match the active catalog" }, { status: 409 });
    }
    const requiredPoints = Math.max(0, Number(reward.points_required || 0));
    const existing = await base44.asServiceRole.entities.UserPoints.filter(
      { customer_email: authenticatedEmail }
    );
    let userPointsRecord = existing[0];
    if (!userPointsRecord) {
      return Response.json({ error: "Loyalty points account not found" }, { status: 404 });
    }
    if (Number(userPointsRecord.total_points || 0) < requiredPoints) {
      return Response.json({
        error: "Not enough points for this reward",
        required_points: requiredPoints,
        available_points: Number(userPointsRecord.total_points || 0)
      }, { status: 409 });
    }
    const claimedRewards = userPointsRecord.claimed_rewards || [];
    const alreadyClaimed = claimedRewards.some((r) => r.reward_id === reward_id);
    if (!alreadyClaimed) {
      claimedRewards.push({
        reward_id,
        reward_title: reward.title,
        reward_type: reward.reward_type,
        points_required: requiredPoints,
        claimed_at: (/* @__PURE__ */ new Date()).toISOString(),
        status: "selected_pending_checkout"
      });
      await base44.asServiceRole.entities.UserPoints.update(userPointsRecord.id, {
        claimed_rewards: claimedRewards
      });
    }
    return Response.json({
      success: true,
      reward_id,
      reward_title: reward.title,
      reward_type: reward.reward_type,
      points_required: requiredPoints,
      already_selected: alreadyClaimed,
      source: "customer_app_native",
      hub_operational_dependency: false
    });
  } catch (error) {
    console.error("Claim reward error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/completeAccountSetup/entry.ts
import { createClientFromRequest as createClientFromRequest4 } from "npm:@base44/sdk@0.8.25";
function normalizeEmail2(value) {
  return String(value || "").trim().toLowerCase();
}
function normalizeText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}
function isValidGuestSecret(value) {
  const normalized = String(value || "").trim();
  return normalized.length >= 24 && normalized.length <= 180 && /^[A-Za-z0-9._:-]+$/.test(normalized);
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}
async function verifyGuestPurchaseClaim(base44, body, contactEmail) {
  const orderNumber = normalizeText(body.guest_order_number, 120).toUpperCase();
  const guestToken = normalizeText(body.guest_order_token, 180);
  if (!orderNumber && !guestToken) return { attempted: false, order: null };
  if (!/^NV-[A-Z0-9-]{3,64}$/.test(orderNumber) || !isValidGuestSecret(guestToken)) {
    return { attempted: true, error: "Guest purchase verification is invalid or expired", status: 403 };
  }
  const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter(
    { order_number: orderNumber },
    "-created_date",
    5
  );
  const expectedHash = await sha256Hex(guestToken);
  const now = Date.now();
  const tokenMatches = checkoutSessions.some((row) => row?.checkout_data?.guest_checkout === true && Number.isFinite(Date.parse(String(row?.expires_at || ""))) && Date.parse(String(row.expires_at)) > now && constantTimeEqual(row?.checkout_data?.guest_order_token_hash, expectedHash));
  if (!tokenMatches) return { attempted: true, error: "Guest purchase verification is invalid or expired", status: 403 };
  const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }, "-created_date", 3);
  const order = orders.find((candidate) => normalizeEmail2(candidate?.customer_email) === contactEmail && (candidate?.payment_captured === true || ["paid", "captured"].includes(String(candidate?.payment_status || "").toLowerCase())) && candidate?.is_test_order !== true);
  if (!order) return { attempted: true, error: "No eligible paid guest purchase was found for this email", status: 403 };
  return { attempted: true, order };
}
async function handler4(req) {
  try {
    const base44 = createClientFromRequest4(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const authenticatedEmail = normalizeEmail2(user.email);
    const requestedEmail = normalizeEmail2(body.email);
    const firstName = normalizeText(body.first_name, 100);
    const lastName = normalizeText(body.last_name, 100);
    const phone = normalizeText(body.phone, 40);
    const address = normalizeText(body.address, 500);
    const birthday = normalizeText(body.birthday, 10);
    if (!authenticatedEmail || !requestedEmail || !firstName || !lastName || !phone) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (requestedEmail !== authenticatedEmail) {
      return Response.json({ error: "Cannot update another customer profile" }, { status: 403 });
    }
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      return Response.json({ error: "Invalid birthday" }, { status: 400 });
    }
    const usesAppleRelay = authenticatedEmail.endsWith("@privaterelay.appleid.com");
    const requestedContactEmail = normalizeEmail2(body.contact_email);
    if (usesAppleRelay && (!requestedContactEmail || !requestedContactEmail.includes("@"))) {
      return Response.json({ error: "A contact email is required" }, { status: 400 });
    }
    const contactEmail = usesAppleRelay ? requestedContactEmail : authenticatedEmail;
    const loyaltyEmail = contactEmail;
    const guestPurchaseClaim = await verifyGuestPurchaseClaim(base44, body, contactEmail);
    if (guestPurchaseClaim.error) {
      return Response.json({ error: guestPurchaseClaim.error }, { status: guestPurchaseClaim.status });
    }
    const optionalProfileFields = {
      ...address ? { address } : {},
      ...birthday ? { birthday } : {}
    };
    try {
      await base44.auth.updateMe({
        first_name: firstName,
        last_name: lastName,
        phone,
        ...optionalProfileFields
      });
    } catch {
      console.warn("[completeAccountSetup] user_projection_update_failed");
    }
    const existingProfiles = await base44.asServiceRole.entities.UserProfile.filter(
      { customer_email: authenticatedEmail },
      "-updated_date",
      2
    );
    const profileData = {
      first_name: firstName,
      last_name: lastName,
      contact_email: contactEmail,
      phone,
      ...optionalProfileFields,
      onboarding_complete: true
    };
    if (existingProfiles[0]) {
      await base44.asServiceRole.entities.UserProfile.update(existingProfiles[0].id, profileData);
    } else {
      await base44.asServiceRole.entities.UserProfile.create({
        customer_email: authenticatedEmail,
        ...profileData
      });
    }
    let loyaltyStatus = "active";
    try {
      const existingMembers = await base44.asServiceRole.entities.LoyaltyMember.filter(
        { email: loyaltyEmail },
        "-updated_date",
        1
      );
      if (!existingMembers[0]) {
        const enrollmentResponse = await base44.functions.invoke("createLoyaltyMember", {
          email: loyaltyEmail,
          auth_email: authenticatedEmail,
          first_name: firstName,
          last_name: lastName,
          phone,
          address: address || null,
          birthday: birthday || null
        });
        const enrollmentResult = enrollmentResponse?.data || enrollmentResponse;
        if (enrollmentResult?.success !== true && enrollmentResult?.existing !== true) {
          loyaltyStatus = "pending_retry";
          console.warn("[completeAccountSetup] loyalty_enrollment_pending");
        }
      }
    } catch {
      loyaltyStatus = "pending_retry";
      console.warn("[completeAccountSetup] loyalty_enrollment_pending");
    }
    return Response.json({
      success: true,
      loyalty_status: loyaltyStatus,
      guest_purchase_claimed: Boolean(guestPurchaseClaim.order),
      claimed_order_number: guestPurchaseClaim.order?.order_number || null,
      message: loyaltyStatus === "active" ? "Account setup complete" : "Account setup complete; rewards enrollment is pending"
    });
  } catch {
    console.error("[completeAccountSetup] setup_failed");
    return Response.json({ error: "Unable to complete setup" }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/createZone3AuthorizationIntent/entry.ts
import { createClientFromRequest as createClientFromRequest5 } from "npm:@base44/sdk@0.8.25";
import Stripe2 from "npm:stripe@14.21.0";
var stripe2 = new Stripe2(Deno.env.get("STRIPE_SECRET_KEY"));
function normalizeDiscountCode(value) {
  return String(value || "").trim().toUpperCase();
}
function normalizeCustomerEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function rowUsesDiscountCode(row, code) {
  const normalizedCode = normalizeDiscountCode(code);
  if (!normalizedCode) return false;
  if (normalizeDiscountCode(row?.promotion_code) === normalizedCode) return true;
  if (normalizeDiscountCode(row?.discount_code) === normalizedCode) return true;
  return (Array.isArray(row?.discount_codes) ? row.discount_codes : []).some((value) => normalizeDiscountCode(value && typeof value === "object" ? value.code : value) === normalizedCode);
}
function orderConsumesDiscount(row) {
  if (row?.payment_captured === true) return true;
  const paymentStates = [row?.payment_status, row?.financial_status].map((value) => String(value || "").trim().toLowerCase());
  if (paymentStates.some((value) => ["paid", "captured", "partially_refunded", "refunded"].includes(value))) return true;
  return ["partially_refunded", "fully_refunded"].includes(String(row?.refund_status || "").trim().toLowerCase());
}
async function customerHasConsumedDiscount(base44, customerEmail, code) {
  const rawEmail = String(customerEmail || "").trim();
  const normalizedEmail = normalizeCustomerEmail(rawEmail);
  if (!normalizedEmail || !normalizeDiscountCode(code)) return false;
  const emailCandidates = [...new Set([rawEmail, normalizedEmail].filter(Boolean))];
  const loadRows = async (entity) => {
    const pages = await Promise.all(emailCandidates.map((email3) => entity.filter({ customer_email: email3 }, "-created_date", 200)));
    return pages.flatMap((rows) => Array.isArray(rows) ? rows : []);
  };
  const [nativeOrders, shopifyOrders, approvalRequests] = await Promise.all([
    loadRows(base44.asServiceRole.entities.Order),
    loadRows(base44.asServiceRole.entities.ShopifyOrder),
    loadRows(base44.asServiceRole.entities.DeliveryApprovalRequest)
  ]);
  if ([...nativeOrders, ...shopifyOrders].some((row) => orderConsumesDiscount(row) && rowUsesDiscountCode(row, code))) return true;
  return approvalRequests.some((row) => rowUsesDiscountCode(row, code) && (String(row?.status || "").trim().toLowerCase() === "captured" || String(row?.stripe_authorization_status || "").trim().toLowerCase() === "succeeded"));
}
async function oneTimeRedemptionBlock(base44, discount, customerEmail) {
  if (!discount?.code || discount.once_per_customer !== true) return null;
  try {
    if (!await customerHasConsumedDiscount(base44, customerEmail, discount.code)) return null;
    return Response.json({
      error: "This one-time welcome offer has already been used on your account.",
      error_code: "DISCOUNT_ALREADY_REDEEMED"
    }, { status: 409 });
  } catch (error) {
    console.error(`[Zone3] One-time discount redemption check failed: ${error.message}`);
    return Response.json({
      error: "We could not verify this one-time offer right now. Please try again in a few minutes.",
      error_code: "DISCOUNT_REDEMPTION_CHECK_UNAVAILABLE"
    }, { status: 503 });
  }
}
async function resolveDiscount(base44, code, eligibleSubtotal, now = /* @__PURE__ */ new Date()) {
  const normalizedCode = normalizeDiscountCode(code);
  const subtotal = Number(eligibleSubtotal);
  if (!Number.isFinite(subtotal) || subtotal < 0) return null;
  if (!normalizedCode) {
    return { code: null, type: "promotion", label: null, percent: 0, amount: 0, once_per_customer: false };
  }
  const candidates = await base44.asServiceRole.entities.DiscountCode.filter(
    { code: normalizedCode },
    "-created_date",
    5
  );
  const activeCandidates = candidates.filter((candidate) => candidate.active === true);
  if (activeCandidates.length !== 1) return null;
  const discount = activeCandidates[0];
  const startsAt = discount.starts_at ? new Date(discount.starts_at) : null;
  const endsAt = discount.ends_at ? new Date(discount.ends_at) : null;
  if (startsAt && (!Number.isFinite(startsAt.getTime()) || now < startsAt) || endsAt && (!Number.isFinite(endsAt.getTime()) || now > endsAt)) {
    return null;
  }
  const minimumSubtotal = Number(discount.minimum_subtotal || 0);
  const value = Number(discount.discount_value);
  if (!Number.isFinite(minimumSubtotal) || subtotal < minimumSubtotal || !Number.isFinite(value) || value <= 0 || discount.discount_type !== "fixed_amount" && value > 100) {
    return null;
  }
  const uncappedAmount = discount.discount_type === "fixed_amount" ? value : Math.round(subtotal * value) / 100;
  const maximumDiscount = Number(discount.maximum_discount || 0);
  const amount = maximumDiscount > 0 ? Math.min(uncappedAmount, maximumDiscount) : uncappedAmount;
  return {
    code: normalizedCode,
    type: discount.discount_kind === "referral" ? "referral" : "promotion",
    label: String(discount.display_name || `${normalizedCode} discount`).trim(),
    percent: discount.discount_type === "fixed_amount" ? 0 : value,
    amount: Math.min(subtotal, Math.round(amount * 100) / 100),
    once_per_customer: discount.once_per_customer === true
  };
}
function normalizeNamePart(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
function splitHumanFullName(value) {
  const normalized = normalizeNamePart(value);
  if (!normalized || normalized.includes("@")) return null;
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}
function resolveCustomerIdentity({
  checkoutFirstName,
  checkoutLastName,
  checkoutCustomerName,
  profile,
  authUser
}) {
  const requestedFirstName = normalizeNamePart(checkoutFirstName);
  const requestedLastName = normalizeNamePart(checkoutLastName);
  if (requestedFirstName && requestedLastName) {
    return {
      firstName: requestedFirstName,
      lastName: requestedLastName,
      source: "checkout_structured"
    };
  }
  const profileFirstName = normalizeNamePart(profile?.first_name);
  const profileLastName = normalizeNamePart(profile?.last_name);
  if (profileFirstName && profileLastName) {
    return {
      firstName: profileFirstName,
      lastName: profileLastName,
      source: "profile_structured"
    };
  }
  const authFirstName = normalizeNamePart(authUser?.first_name);
  const authLastName = normalizeNamePart(authUser?.last_name);
  if (authFirstName && authLastName) {
    return {
      firstName: authFirstName,
      lastName: authLastName,
      source: "auth_structured"
    };
  }
  const split = splitHumanFullName(checkoutCustomerName);
  if (split) return { ...split, source: "checkout_full_name" };
  return null;
}
async function authorizeCheckoutCustomer(base44, customerEmail) {
  const user = await base44.auth.me().catch(() => null);
  const requested = String(customerEmail || "").trim().toLowerCase();
  const requester = String(user?.email || "").trim().toLowerCase();
  if (!user?.email || !requested) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role === "admin" || requester === requested) return null;
  return Response.json({ error: "forbidden" }, { status: 403 });
}
var ORIGIN_ADDRESS = "619 N Main St, O'Fallon, MO 63366";
var ALL_ZONE_RULES = [
  { zone_key: "zone_1a_core_0_5", zone_name: "Core Delivery", zone_tier_label: "Core Delivery", zone_type: "core", min: 0, max: 5, delivery_fee: 3.99, minimum_order: null },
  { zone_key: "zone_1b_core_5_10", zone_name: "Core Delivery", zone_tier_label: "Core Delivery", zone_type: "core", min: 5.01, max: 10, delivery_fee: 5.99, minimum_order: null },
  { zone_key: "zone_1c_core_10_15", zone_name: "Core Delivery", zone_tier_label: "Core Delivery", zone_type: "core", min: 10.01, max: 15, delivery_fee: 7.99, minimum_order: null },
  { zone_key: "zone_2_extended", zone_name: "Extended Delivery", zone_tier_label: "Extended Delivery", zone_type: "extended", min: 15.01, max: 25, delivery_fee: 9.99, minimum_order: 49.99 },
  { zone_key: "zone_3a_route_review_25_30", zone_name: "Route Review Zone", zone_tier_label: "Route Review Required", zone_type: "route_review", min: 25.01, max: 30, delivery_fee: 12.99, minimum_order: 59.99 },
  { zone_key: "zone_3b_route_review_30_35", zone_name: "Extended Route Review Zone", zone_tier_label: "Route Review Required", zone_type: "route_review", min: 30.01, max: 35, delivery_fee: 15.99, minimum_order: 72 },
  { zone_key: "waitlist_only", zone_name: "Delivery Waitlist Area", zone_tier_label: "Not Yet Available", zone_type: "waitlist_only", min: 35.01, max: 99999, delivery_fee: null, minimum_order: null }
];
var ZONE_RULES = ALL_ZONE_RULES.filter((z) => z.zone_type === "route_review" || z.zone_type === "waitlist_only");
async function canUseTestDistanceOverride(base44, req) {
  if (Deno.env.get("NUVIRA_STAGING_SAFE_MODE") !== "true") return false;
  const user = await base44.auth.me().catch(() => null);
  return user?.role === "admin";
}
async function getEligibility(address, subtotal, context = {}) {
  const { base44, req, testDistanceMiles } = context;
  let distanceMiles = null;
  let driveTimeMinutes = null;
  let distanceConfidence = "driving";
  if (typeof testDistanceMiles === "number") {
    if (!await canUseTestDistanceOverride(base44, req)) {
      throw new Error("_test_distance_miles override is only allowed in Gate D staging admin context");
    }
    distanceMiles = testDistanceMiles;
    driveTimeMinutes = Math.round(testDistanceMiles * 1.5);
    distanceConfidence = "staging_test";
    console.log(`[Zone3] STAGING TEST distance override: ${distanceMiles} miles`);
  }
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (distanceMiles === null) {
    if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured");
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK") throw new Error(`Maps API: ${data.status}`);
    const element = data.rows?.[0]?.elements?.[0];
    if (element?.status !== "OK") throw new Error(`Maps element: ${element?.status}`);
    distanceMiles = Math.round(element.distance.value / 1609.344 * 10) / 10;
    driveTimeMinutes = Math.round(element.duration.value / 60);
  }
  const zone = ALL_ZONE_RULES.find((z) => distanceMiles >= z.min && distanceMiles <= z.max) || ALL_ZONE_RULES[ALL_ZONE_RULES.length - 1];
  const z3 = ZONE_RULES.find((z) => distanceMiles >= z.min && distanceMiles <= z.max) || null;
  const minimumMet = !z3?.minimum_order || subtotal >= z3.minimum_order;
  return { zone_key: zone.zone_key, zone_type: zone.zone_type, zone_name: z3?.zone_name || zone.zone_key, delivery_fee: z3?.delivery_fee || null, minimum_order: z3?.minimum_order || null, minimum_order_met: minimumMet, amount_needed: minimumMet ? 0 : Math.round((z3.minimum_order - subtotal) * 100) / 100, estimated_distance_miles: distanceMiles, estimated_drive_time_minutes: driveTimeMinutes, distance_confidence: distanceConfidence };
}
async function handler5(req) {
  try {
    const base44 = createClientFromRequest5(req);
    const body = await req.json();
    const unauthorized = await authorizeCheckoutCustomer(base44, body.customer_email);
    if (unauthorized) return unauthorized;
    const authenticatedUser = await base44.auth.me().catch(() => null);
    const items = body.items ?? body.cart_items ?? [];
    const subtotal = body.subtotal ?? body.cart_subtotal ?? 0;
    const delivery_fee = body.delivery_fee ?? null;
    const total = body.total ?? null;
    const delivery_address = body.delivery_address ?? null;
    const address_line1 = body.address_line1 ?? "";
    const address_line2 = body.address_line2 ?? "";
    const address_city = body.address_city ?? "";
    const address_state = body.address_state ?? "";
    const address_postal_code = body.address_postal_code ?? "";
    const contact_phone = body.contact_phone ?? body.customer_phone ?? body.phone ?? "";
    const customer_email = body.customer_email ?? "";
    const inputCustomerName = body.customer_name ?? "";
    const inputCustomerFirstName = body.customer_first_name ?? "";
    const inputCustomerLastName = body.customer_last_name ?? "";
    const customer_acknowledged_hold = body.customer_acknowledged_hold ?? false;
    const testDistanceMiles = body._test_distance_miles;
    const discountCode = body.discount_code ?? body.promotion_code ?? body.referral_code ?? null;
    const discountEligibleSubtotal = Number(body.discount_eligible_subtotal ?? subtotal);
    if (!Number.isFinite(discountEligibleSubtotal) || Math.abs(discountEligibleSubtotal - Number(subtotal || 0)) > 0.01) {
      return Response.json({
        error: "The route-review checkout total could not be verified.",
        error_code: "INVALID_DISCOUNT_SUBTOTAL"
      }, { status: 400 });
    }
    const normalizedPhone = String(contact_phone || "").trim();
    const normalizedAddress = {
      line1: String(address_line1 || "").trim(),
      line2: String(address_line2 || "").trim(),
      city: String(address_city || "").trim(),
      state: String(address_state || "").trim(),
      postalCode: String(address_postal_code || "").trim()
    };
    const invalidItem = !Array.isArray(items) || items.length === 0 || items.some((item) => !String(item?.title || "").trim() || !Number.isFinite(Number(item?.price)) || Number(item?.price) < 0 || !Number.isInteger(Number(item?.quantity)) || Number(item?.quantity) < 1);
    if (invalidItem) {
      return Response.json({
        error: "Your cart contains an invalid item. Please review it and try again.",
        error_code: "INVALID_ORDER_ITEMS"
      }, { status: 400 });
    }
    if (normalizedPhone.replace(/\D/g, "").length < 10) {
      return Response.json({
        error: "A valid phone number is required for fulfillment.",
        error_code: "CUSTOMER_PHONE_REQUIRED"
      }, { status: 400 });
    }
    if (!normalizedAddress.line1 || !normalizedAddress.city || !normalizedAddress.state || !normalizedAddress.postalCode) {
      return Response.json({
        error: "A complete delivery address is required.",
        error_code: "DELIVERY_ADDRESS_REQUIRED"
      }, { status: 400 });
    }
    if (!customer_acknowledged_hold) {
      return Response.json({ error: "Customer must acknowledge the authorization hold before proceeding." }, { status: 400 });
    }
    const discount = await resolveDiscount(base44, discountCode, discountEligibleSubtotal);
    if (!discount) {
      return Response.json({
        error: "This discount code is not valid for the current order.",
        error_code: "INVALID_DISCOUNT_CODE"
      }, { status: 400 });
    }
    const redemptionBlock = await oneTimeRedemptionBlock(base44, discount, customer_email || authenticatedUser?.email);
    if (redemptionBlock) return redemptionBlock;
    let customerProfile = null;
    if (customer_email) {
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
      customerProfile = profiles[0] || null;
    }
    const customerIdentity = resolveCustomerIdentity({
      checkoutFirstName: inputCustomerFirstName,
      checkoutLastName: inputCustomerLastName,
      checkoutCustomerName: inputCustomerName,
      profile: customerProfile,
      authUser: authenticatedUser
    });
    if (!customerIdentity) {
      return Response.json({
        error: "A first and last name are required for receipts and delivery.",
        error_code: "CUSTOMER_NAME_REQUIRED"
      }, { status: 400 });
    }
    const customer_name = `${customerIdentity.firstName} ${customerIdentity.lastName}`;
    const addrString = delivery_address || [
      normalizedAddress.line1,
      normalizedAddress.city,
      normalizedAddress.state,
      normalizedAddress.postalCode
    ].filter(Boolean).join(", ");
    if (!addrString || addrString.trim().length < 5) return Response.json({ error: "Valid delivery address is required." }, { status: 400 });
    let eligibility;
    try {
      eligibility = await getEligibility(addrString, subtotal || 0, {
        base44,
        req,
        testDistanceMiles
      });
    } catch (err) {
      console.error(`[Zone3] Eligibility check failed: ${err.message}`);
      return Response.json({ error: "Could not verify delivery eligibility. Please try again." }, { status: 400 });
    }
    if (eligibility.zone_type !== "route_review") {
      return Response.json({
        error: eligibility.zone_type === "waitlist_only" ? "Your address is outside our delivery area. You can join the waitlist." : "This address does not require route review. Please use the standard checkout.",
        zone_type: eligibility.zone_type,
        zone_key: eligibility.zone_key
      }, { status: 400 });
    }
    if (!eligibility.minimum_order_met) {
      return Response.json({
        error: `A minimum order of $${eligibility.minimum_order?.toFixed(2)} is required for your delivery area. Add $${eligibility.amount_needed?.toFixed(2)} more to continue.`,
        reason_code: "MINIMUM_ORDER_NOT_MET",
        amount_needed: eligibility.amount_needed
      }, { status: 400 });
    }
    const estimatedDeliveryFee = eligibility.delivery_fee || (delivery_fee || 0);
    const discountedMerchandiseTotal = Math.max(0, discountEligibleSubtotal - discount.amount);
    const effectiveTotal = Math.max(0, Math.round((discountedMerchandiseTotal + estimatedDeliveryFee) * 100) / 100);
    const amountCents = Math.max(50, Math.round(effectiveTotal * 100));
    const requestNumber = `DAR-${Date.now().toString(36).toUpperCase()}`;
    const darRecord = await base44.asServiceRole.entities.DeliveryApprovalRequest.create({
      request_number: requestNumber,
      customer_name,
      customer_email: customer_email || "",
      customer_phone: normalizedPhone,
      delivery_address: addrString,
      address_line1: normalizedAddress.line1,
      address_line2: normalizedAddress.line2,
      address_city: normalizedAddress.city,
      address_state: normalizedAddress.state,
      address_postal_code: normalizedAddress.postalCode,
      address_country: "US",
      cart_items: (items || []).map((i) => ({ product_id: i.product_id, title: i.title, price: i.price, quantity: i.quantity })),
      cart_subtotal: subtotal || 0,
      discount_eligible_subtotal: discountEligibleSubtotal,
      discount_amount: discount.amount,
      discount_percent: discount.percent,
      ...discount.code ? {
        discount_code: discount.code,
        discount_kind: discount.type
      } : {},
      estimated_delivery_fee: estimatedDeliveryFee,
      estimated_total: effectiveTotal,
      estimated_distance_miles: eligibility.estimated_distance_miles,
      estimated_drive_time_minutes: eligibility.estimated_drive_time_minutes,
      zone_key: eligibility.zone_key,
      zone_name: eligibility.zone_name,
      zone_type: eligibility.zone_type,
      customer_acknowledged_hold: true,
      status: "pending_authorization",
      audit_trail: [{
        action: "authorization_initiated",
        performed_by: customer_email || "customer",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        note: `Zone 3 route review initiated. Distance: ${eligibility.estimated_distance_miles} miles. Zone: ${eligibility.zone_key}.${discount.code ? ` Discount: ${discount.code} (-$${discount.amount.toFixed(2)}).` : ""}`
      }]
    });
    console.log(`[Zone3] DeliveryApprovalRequest created: ${darRecord.id} (${requestNumber})`);
    const paymentIntent = await stripe2.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      capture_method: "manual",
      payment_method_types: ["card"],
      receipt_email: customer_email || void 0,
      description: `NuVira Zone 3 Route Review ${requestNumber}`,
      metadata: {
        base44_app_id: Deno.env.get("BASE44_APP_ID"),
        source_app: "customer_app",
        checkout_version: "zone3_manual_capture_v1",
        flow_type: "zone3_route_review",
        request_number: requestNumber,
        dar_id: darRecord.id,
        order_type: "one_time",
        customer_email: customer_email || "",
        customer_name,
        customer_first_name: customerIdentity.firstName,
        customer_last_name: customerIdentity.lastName,
        customer_name_source: customerIdentity.source,
        customer_phone: normalizedPhone,
        delivery_address_line1: normalizedAddress.line1,
        delivery_address_line2: normalizedAddress.line2,
        delivery_city: normalizedAddress.city,
        delivery_state: normalizedAddress.state,
        delivery_postal_code: normalizedAddress.postalCode,
        delivery_zone_key: eligibility.zone_key,
        delivery_zone_type: eligibility.zone_type,
        estimated_distance_miles: String(eligibility.estimated_distance_miles || ""),
        estimated_delivery_fee: String(estimatedDeliveryFee),
        cart_subtotal: String(subtotal || 0),
        discount_eligible_subtotal: String(discountEligibleSubtotal),
        discount_code: discount.code || "",
        discount_kind: discount.code ? discount.type : "",
        discount_amount: discount.amount.toFixed(2),
        effective_total: String(effectiveTotal),
        customer_acknowledged_hold: "true"
      },
      shipping: {
        name: customer_name,
        phone: normalizedPhone,
        address: {
          line1: normalizedAddress.line1,
          line2: normalizedAddress.line2 || void 0,
          city: normalizedAddress.city,
          state: normalizedAddress.state,
          postal_code: normalizedAddress.postalCode,
          country: "US"
        }
      }
    });
    await base44.asServiceRole.entities.DeliveryApprovalRequest.update(darRecord.id, {
      stripe_payment_intent_id: paymentIntent.id,
      amount_authorized: effectiveTotal,
      authorization_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString()
      // Stripe holds up to 7 days
    });
    console.log(`[Zone3] PI ${paymentIntent.id} created for DAR ${requestNumber}, amount=${amountCents}\xA2, capture_method=manual`);
    return Response.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      publishableKey: Deno.env.get("STRIPE_PUBLISHABLE_KEY"),
      requestNumber,
      darId: darRecord.id,
      effectiveTotal,
      estimatedDeliveryFee,
      zoneKey: eligibility.zone_key,
      zoneName: eligibility.zone_name,
      distanceMiles: eligibility.estimated_distance_miles,
      discountCode: discount.code,
      discountLabel: discount.label,
      discountAmount: discount.amount
    });
  } catch (error) {
    console.error("[Zone3] createZone3AuthorizationIntent error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts
import { createClientFromRequest as createClientFromRequest6 } from "npm:@base44/sdk@0.8.25";
var CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ENABLE = "ENABLE_CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST";
var CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_KILL_SWITCH = "CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_KILL_SWITCH";
var CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ALLOWLIST = "CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST";
var CUSTOMER_ORDER_HISTORY_SOURCE_MERGE_KILL_SWITCH = "CUSTOMER_ORDER_HISTORY_SOURCE_MERGE_KILL_SWITCH";
var CUSTOMER_REWARDS_NATIVE_FIRST_READS_ENABLE = "ENABLE_CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_READS";
var CUSTOMER_REWARDS_NATIVE_FIRST_READS_KILL_SWITCH = "CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_KILL_SWITCH";
var CUSTOMER_REWARDS_NATIVE_FIRST_READS_USER_POINTS_ALLOWLIST = "CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST";
function normalizeText2(value) {
  return String(value ?? "").trim();
}
function normalizeLower(value) {
  return normalizeText2(value).toLowerCase();
}
function normalizeEmail3(value) {
  return normalizeLower(value);
}
function normalizePhone(value) {
  const digits = normalizeText2(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : "";
}
function phoneQueryVariants(value) {
  const raw = normalizeText2(value);
  const digits = normalizePhone(raw);
  if (!digits) return raw ? [raw] : [];
  const area = digits.slice(0, 3);
  const prefix = digits.slice(3, 6);
  const line = digits.slice(6);
  return Array.from(new Set([
    raw,
    digits,
    `1${digits}`,
    `+1${digits}`,
    `${area}-${prefix}-${line}`,
    `(${area}) ${prefix}-${line}`,
    `${area} ${prefix} ${line}`
  ].filter(Boolean)));
}
function normalizeOrderNumber(value) {
  return normalizeText2(value).replace(/^#/, "").toUpperCase();
}
function envEnabled(name) {
  return ["1", "true", "yes", "on", "enabled"].includes(normalizeLower(Deno.env.get(name)));
}
function parseCsvSet(value) {
  return new Set(normalizeText2(value).split(",").map((part) => normalizeOrderNumber(part)).filter(Boolean));
}
function parseIdentifierCsvSet(value) {
  return new Set(normalizeText2(value).split(",").map((part) => normalizeText2(part)).filter(Boolean));
}
function uniqueRows(rows) {
  const seen = /* @__PURE__ */ new Set();
  const unique2 = [];
  for (const row of rows || []) {
    const key = row?.id || JSON.stringify(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique2.push(row);
  }
  return unique2;
}
function isOpenReviewRow(row) {
  const status = normalizeLower(row?.status || row?.queue_visibility_status);
  return row && !["resolved", "archived", "rejected"].includes(status);
}
function rowTextIncludes(row, tokens) {
  const text = [
    row?.sync_source,
    row?.triggered_by,
    row?.reason,
    row?.description,
    row?.action,
    row?.hub_action,
    row?.native_parity_status,
    row?.bridge_action,
    row?.source
  ].map(normalizeLower).join(" ");
  return tokens.some((token) => text.includes(token));
}
function looksSubscriptionOrMultiDelivery(order, nativeOrder, task) {
  const values = [
    order?.order_type,
    order?.source_type,
    order?.fulfillment_mode,
    nativeOrder?.order_type,
    nativeOrder?.source_type,
    nativeOrder?.source_channel,
    nativeOrder?.fulfillment_mode,
    task?.order_type,
    task?.source_type,
    task?.fulfillment_type
  ].map(normalizeLower);
  return Boolean(
    order?.is_subscription || nativeOrder?.is_subscription || values.some((value) => value.includes("subscription") || value.includes("multi_delivery") || value.includes("multi-delivery"))
  );
}
function looksRefunded(order, nativeOrder) {
  return [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    order?.refund_status,
    nativeOrder?.payment_status,
    nativeOrder?.financial_status,
    nativeOrder?.refund_status,
    nativeOrder?.production_status
  ].some((value) => normalizeLower(value).includes("refund")) || Boolean(order?.refunded_at || nativeOrder?.refunded_at);
}
function looksHistoricalLateMirror(order, nativeOrder, task) {
  const text = [
    order?.notes,
    order?.source_type,
    order?.sync_status,
    nativeOrder?.source_type,
    nativeOrder?.sync_status,
    nativeOrder?.repair_status,
    task?.source_type,
    task?.task_source,
    task?.sync_status
  ].map(normalizeLower).join(" ");
  return ["historical", "late_mirror", "late-mirror", "backfill"].some((token) => text.includes(token));
}
function looksCancelled(order, nativeOrder, task) {
  return [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    nativeOrder?.production_status,
    nativeOrder?.order_status,
    nativeOrder?.payment_status,
    task?.status,
    task?.delivery_status
  ].some((value) => ["cancelled", "canceled", "failed", "voided"].includes(normalizeLower(value)));
}
function hasPaidCaptured(order) {
  return Boolean(
    order?.payment_captured === true && ["paid", ""].includes(normalizeLower(order?.payment_status || "paid")) && ["paid", ""].includes(normalizeLower(order?.financial_status || "paid"))
  );
}
function nativePaymentIsPaid(nativeOrder, task) {
  const paymentValues = [nativeOrder?.payment_status, nativeOrder?.financial_status, task?.payment_status].map(normalizeLower).filter(Boolean);
  return paymentValues.length === 0 || paymentValues.every((value) => value === "paid");
}
function mapProductionStatus(value) {
  const status = normalizeLower(value);
  const map = {
    new: "scheduled_for_juicing",
    awaiting_production: "scheduled_for_juicing",
    pending: "scheduled_for_juicing",
    scheduled: "scheduled_for_juicing",
    production_scheduled: "scheduled_for_juicing",
    in_production: "in_production",
    bottled: "bottled_packed",
    labeled: "bottled_packed",
    qc_checked: "bottled_packed",
    packed: "bottled_packed",
    in_cold_storage: "bottled_packed",
    assigned_for_pickup: "ready_for_pickup",
    assigned_for_delivery: "out_for_delivery",
    out_for_delivery: "out_for_delivery",
    arriving_soon: "arriving_soon",
    fulfilled: "delivered",
    delivered: "delivered",
    picked_up: "picked_up",
    ready_for_pickup: "ready_for_pickup",
    order_received: "order_received",
    scheduled_for_juicing: "scheduled_for_juicing",
    scheduled_for_production: "scheduled_for_juicing",
    bottled_packed: "bottled_packed"
  };
  return map[status] || status;
}
function mapFulfillmentStatus(value) {
  const status = normalizeLower(value);
  const map = {
    pending_production: "pending",
    pending: "pending",
    scheduled: "pending",
    assigned: "pending",
    ready_for_delivery: "packed",
    packed: "packed",
    bottled_packed: "packed",
    fulfilled: "delivered",
    delivered: "delivered",
    out_for_delivery: "out_for_delivery",
    in_transit: "out_for_delivery",
    cancelled: "cancelled",
    canceled: "cancelled"
  };
  return map[status] || status;
}
function comparableValuesDiffer(left, right, mapper = (value) => normalizeLower(value)) {
  const normalizedLeft = mapper(left);
  const normalizedRight = mapper(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft !== normalizedRight;
}
function deliveryDateForOrder(order) {
  return normalizeText2(order?.assigned_delivery_date || order?.estimated_delivery_date || order?.delivery_date || order?.assigned_delivery_day);
}
function deliveryDateForNative(nativeOrder, task) {
  return normalizeText2(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || nativeOrder?.requested_delivery_date);
}
function buildNativeOrderHistoryPatch(order, nativeOrder, task) {
  const patch = {};
  const mappedStatus = mapProductionStatus(task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status);
  if (!order?.status && mappedStatus) patch.status = mappedStatus;
  const productionStatus = normalizeText2(task?.production_status || nativeOrder?.production_status);
  if (productionStatus) patch.production_status = productionStatus;
  const fulfillmentStatus = normalizeText2(nativeOrder?.fulfillment_status || task?.status);
  if (fulfillmentStatus) patch.fulfillment_status = fulfillmentStatus;
  const deliveryStatus = normalizeText2(task?.delivery_status);
  if (deliveryStatus) patch.delivery_status = deliveryStatus;
  const deliveryWindowLabel = normalizeText2(order?.delivery_window_label || task?.delivery_window_label || nativeOrder?.delivery_window_label);
  if (!order?.delivery_window_label && deliveryWindowLabel) patch.delivery_window_label = deliveryWindowLabel;
  return patch;
}
function hasDuplicateIdentity(nativeOrders, tasks) {
  return uniqueRows(nativeOrders).length !== 1 || uniqueRows(tasks).length !== 1;
}
function nativeContextEligible(order, nativeOrders, tasks, reviewRows, syncRows, parityRows) {
  const nativeOrderList = uniqueRows(nativeOrders);
  const taskList = uniqueRows(tasks);
  const nativeOrder = nativeOrderList[0] || null;
  const task = taskList[0] || null;
  const blockers = [];
  if (!order) blockers.push("customer_app_order_missing");
  if (hasDuplicateIdentity(nativeOrderList, taskList)) blockers.push("duplicate_or_missing_native_identity");
  if (!nativeOrder) blockers.push("native_shopify_order_missing");
  if (!task) blockers.push("native_fulfillment_task_missing");
  if (looksSubscriptionOrMultiDelivery(order, nativeOrder, task)) blockers.push("subscription_multi_delivery_hub_source_of_truth");
  if (looksRefunded(order, nativeOrder)) blockers.push("refund_payment_hub_source_of_truth");
  if (looksCancelled(order, nativeOrder, task)) blockers.push("cancelled_payment_risk");
  if (looksHistoricalLateMirror(order, nativeOrder, task)) blockers.push("historical_late_mirror_preserve_current_behavior");
  if (!hasPaidCaptured(order)) blockers.push("payment_not_paid_captured");
  if (!nativePaymentIsPaid(nativeOrder, task)) blockers.push("payment_mismatch");
  if ((reviewRows || []).some(isOpenReviewRow)) blockers.push("order_review_queue_hold");
  if ((syncRows || []).some((row) => rowTextIncludes(row, ["repair", "replay", "retry", "recovery"]))) blockers.push("repair_replay_hold");
  if ((parityRows || []).some((row) => ["mismatch", "blocked", "needs_manual_review"].includes(normalizeLower(row?.native_parity_status)))) blockers.push("repair_replay_hold");
  const customerStatus = order?.status;
  const nativeStatus = task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status;
  if (comparableValuesDiffer(customerStatus, nativeStatus, mapProductionStatus)) blockers.push("status_mismatch");
  const customerPayment = order?.payment_status || order?.financial_status;
  const nativePayment = nativeOrder?.payment_status || nativeOrder?.financial_status || task?.payment_status;
  if (comparableValuesDiffer(customerPayment, nativePayment)) blockers.push("payment_mismatch");
  const customerFulfillment = order?.fulfillment_status;
  const nativeFulfillment = nativeOrder?.fulfillment_status || task?.status;
  if (comparableValuesDiffer(customerFulfillment, nativeFulfillment, mapFulfillmentStatus)) blockers.push("fulfillment_mismatch");
  const customerDate = deliveryDateForOrder(order);
  const nativeDate = deliveryDateForNative(nativeOrder, task);
  if (customerDate && nativeDate && customerDate !== nativeDate) blockers.push("delivery_schedule_mismatch");
  return {
    eligible: blockers.length === 0,
    blockers: Array.from(new Set(blockers)),
    nativeOrder,
    task
  };
}
async function safeFilter(entity, filter, sort = null, limit = 20) {
  if (!entity?.filter) return [];
  try {
    return await entity.filter(filter, sort, limit) || [];
  } catch (error) {
    console.warn("[getCustomerAccountDashboardData] native history context read skipped:", error?.message || error);
    return [];
  }
}
async function loadNativeHistoryContextForOrder(base44, order) {
  const entities = base44.asServiceRole.entities;
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const nativeOrderQueries = [];
  if (order?.id) {
    nativeOrderQueries.push({ base44_order_id: order.id });
    nativeOrderQueries.push({ customer_app_order_id: order.id });
  }
  if (orderNumber) {
    nativeOrderQueries.push({ shopify_order_number: orderNumber });
    nativeOrderQueries.push({ order_number: orderNumber });
  }
  const nativeOrders = uniqueRows((await Promise.all(nativeOrderQueries.map((query) => safeFilter(entities.ShopifyOrder, query, null, 5)))).flat()).filter((nativeOrder2) => {
    const nativeOrderNumber = normalizeOrderNumber(nativeOrder2?.shopify_order_number || nativeOrder2?.order_number);
    return (!order?.id || nativeOrder2?.base44_order_id === order.id || nativeOrder2?.customer_app_order_id === order.id || nativeOrderNumber === orderNumber) && (!orderNumber || !nativeOrderNumber || nativeOrderNumber === orderNumber);
  });
  const nativeOrder = nativeOrders[0] || null;
  const taskQueries = [];
  if (nativeOrder?.id) {
    taskQueries.push({ native_shopify_order_id: nativeOrder.id });
    taskQueries.push({ shopify_order_id: nativeOrder.id });
  }
  if (order?.id) taskQueries.push({ base44_order_id: order.id });
  if (orderNumber) taskQueries.push({ order_number: orderNumber });
  const tasks = uniqueRows((await Promise.all(taskQueries.map((query) => safeFilter(entities.FulfillmentTask, query, null, 10)))).flat()).filter((task) => {
    const taskOrderNumber = normalizeOrderNumber(task?.order_number || task?.shopify_order_number);
    const taskNativeLinkMatches = !nativeOrder?.id || task?.native_shopify_order_id === nativeOrder.id || task?.shopify_order_id === nativeOrder.id || taskOrderNumber === orderNumber;
    const taskCustomerLinkMatches = !order?.id || task?.base44_order_id === order.id || task?.order_id === order.id || taskOrderNumber === orderNumber;
    return taskNativeLinkMatches && taskCustomerLinkMatches && (!orderNumber || !taskOrderNumber || taskOrderNumber === orderNumber);
  });
  const reviewRows = uniqueRows([
    ...order?.id ? await safeFilter(entities.OrderReviewQueue, { existing_order_id: order.id }, "-created_date", 10) : [],
    ...orderNumber ? await safeFilter(entities.OrderReviewQueue, { existing_order_number: orderNumber }, "-created_date", 10) : []
  ]);
  const syncRows = uniqueRows([
    ...order?.id ? await safeFilter(entities.OrderSyncLog, { order_id: order.id }, "-created_date", 10) : [],
    ...orderNumber ? await safeFilter(entities.OrderSyncLog, { order_number: orderNumber }, "-created_date", 10) : []
  ]);
  const parityRows = uniqueRows([
    ...order?.id ? await safeFilter(entities.SafeSyncParityLog, { order_id: order.id }, "-created_date", 10) : [],
    ...orderNumber ? await safeFilter(entities.SafeSyncParityLog, { order_number: orderNumber }, "-created_date", 10) : []
  ]);
  return { nativeOrders, tasks, reviewRows, syncRows, parityRows };
}
async function applyLimitedNativeFirstOrderHistory(base44, orders) {
  if (!envEnabled(CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ENABLE)) return orders;
  if (envEnabled(CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_KILL_SWITCH)) return orders;
  const allowlist = parseCsvSet(Deno.env.get(CUSTOMER_ORDER_HISTORY_NATIVE_FIRST_ALLOWLIST));
  if (allowlist.size === 0) return orders;
  const enriched = [];
  for (const order of orders || []) {
    const orderNumber = normalizeOrderNumber(order?.order_number);
    if (!orderNumber || !allowlist.has(orderNumber)) {
      enriched.push(order);
      continue;
    }
    const context = await loadNativeHistoryContextForOrder(base44, order);
    const eligibility = nativeContextEligible(order, context.nativeOrders, context.tasks, context.reviewRows, context.syncRows, context.parityRows);
    if (!eligibility.eligible) {
      enriched.push(order);
      continue;
    }
    enriched.push({
      ...order,
      ...buildNativeOrderHistoryPatch(order, eligibility.nativeOrder, eligibility.task)
    });
  }
  return enriched;
}
function paymentWasCaptured(row) {
  return Boolean(
    row?.payment_captured === true || ["paid", "refunded"].includes(normalizeLower(row?.payment_status)) || ["paid", "refunded"].includes(normalizeLower(row?.financial_status))
  );
}
function isExplicitInternalTestOrder(row) {
  const tags = Array.isArray(row?.tags) ? row.tags.map(normalizeLower) : [];
  const visibility = normalizeLower(row?.operational_visibility);
  const quality = normalizeLower(row?.data_quality_status);
  return row?.is_test_order === true || tags.includes("internal_test") || tags.includes("test_order") || ["internal_test", "archived_test"].includes(visibility) || ["internal_test", "test_order"].includes(quality);
}
function authoritativeCustomerOrderStatus(order) {
  const payment = normalizeLower(order?.payment_status || order?.financial_status);
  const refund = normalizeLower(order?.refund_status);
  if (payment === "refunded" || refund.includes("refund") || order?.refunded_at) return "refunded";
  const statusValues = [
    order?.order_status,
    order?.fulfillment_status,
    order?.shopify_fulfillment_status,
    order?.production_status
  ].map(normalizeLower).filter(Boolean);
  if (statusValues.some((value) => ["cancelled", "canceled", "failed", "voided"].includes(value))) return "cancelled";
  if (statusValues.some((value) => ["fulfilled", "delivered", "picked_up"].includes(value))) {
    return ["pickup", "pos"].includes(normalizeLower(order?.fulfillment_method)) ? "picked_up" : "delivered";
  }
  const mapped = mapProductionStatus(
    order?.order_status || order?.production_status || order?.fulfillment_status || order?.shopify_fulfillment_status
  );
  if (mapped && mapped !== "not_required") return mapped;
  return normalizeLower(order?.source_channel) === "pos" ? "picked_up" : "order_received";
}
var CUSTOMER_DELIVERY_PROGRESS_RANK = Object.freeze({
  order_received: 0,
  scheduled_for_juicing: 1,
  in_production: 2,
  bottled_packed: 3,
  out_for_delivery: 4,
  arriving_soon: 5
});
function customerDeliveryProgressStatus(value) {
  const status = normalizeLower(value).replace(/[\s-]+/g, "_");
  const map = {
    confirmed: "order_received",
    paid: "order_received",
    processing: "order_received",
    order_received: "order_received",
    new: "scheduled_for_juicing",
    pending: "scheduled_for_juicing",
    scheduled: "scheduled_for_juicing",
    awaiting_production: "scheduled_for_juicing",
    production_scheduled: "scheduled_for_juicing",
    scheduled_for_production: "scheduled_for_juicing",
    scheduled_for_juicing: "scheduled_for_juicing",
    in_production: "in_production",
    preparing: "in_production",
    producing: "in_production",
    bottled: "bottled_packed",
    labeled: "bottled_packed",
    packed: "bottled_packed",
    ready_for_delivery: "bottled_packed",
    route_assigned: "bottled_packed",
    in_cold_storage: "bottled_packed",
    qc_checked: "bottled_packed",
    completed_pending_verification: "bottled_packed",
    verified_logged: "bottled_packed",
    completed: "bottled_packed",
    complete: "bottled_packed",
    fulfilled: "bottled_packed",
    picked_up: "bottled_packed",
    bottled_packed: "bottled_packed",
    assigned_for_delivery: "out_for_delivery",
    on_route: "out_for_delivery",
    in_transit: "out_for_delivery",
    out_for_delivery: "out_for_delivery",
    arriving_soon: "arriving_soon"
  };
  return map[status] || null;
}
function strongestCustomerDeliveryProgress(values) {
  return values.map(customerDeliveryProgressStatus).filter(Boolean).sort((left, right) => CUSTOMER_DELIVERY_PROGRESS_RANK[right] - CUSTOMER_DELIVERY_PROGRESS_RANK[left])[0] || "order_received";
}
function customerHistoryLifecycleStatus(order, tasks = []) {
  const currentStatus = normalizeLower(order?.status);
  if (["cancelled", "canceled", "refunded", "failed"].includes(currentStatus)) return currentStatus === "canceled" ? "cancelled" : currentStatus;
  if (normalizeLower(order?.fulfillment_type) === "pickup") return currentStatus;
  if (order?.delivered_at) return "delivered";
  const linkedTasks = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
  if (linkedTasks.length === 0) return currentStatus;
  const taskDelivered = (task) => normalizeLower(task?.delivery_status) === "delivered" || normalizeLower(task?.status) === "delivered" || Boolean(task?.delivered_at);
  if (linkedTasks.every(taskDelivered)) return "delivered";
  const safeOrderStatus = ["out_for_delivery", "arriving_soon", "delivered", "picked_up"].includes(currentStatus) ? null : order?.status;
  return strongestCustomerDeliveryProgress([
    ...linkedTasks.flatMap((task) => [task?.delivery_status, task?.status, task?.production_status]),
    order?.delivery_status,
    safeOrderStatus,
    order?.production_status,
    order?.fulfillment_status
  ]);
}
function sanitizeAuthoritativeHistoryOrder(order) {
  const orderNumber = normalizeOrderNumber(order?.shopify_order_number || order?.order_number);
  const items = (Array.isArray(order?.line_items) ? order.line_items : []).map((item) => ({
    product_id: normalizeText2(item?.product_id || item?.shopify_product_id) || null,
    title: normalizeText2(item?.title || item?.name) || "Item",
    price: finiteNumber(item?.price) ?? 0,
    quantity: finiteNumber(item?.quantity) ?? 1,
    image_url: normalizeText2(item?.image_url) || null,
    size: normalizeText2(item?.variant_title) || null
  }));
  const total = finiteNumber(order?.total_price ?? order?.total) ?? 0;
  const subtotal = finiteNumber(order?.subtotal) ?? total;
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);
  return {
    id: `shopify_order_${normalizeText2(order?.id) || orderNumber}`,
    order_number: orderNumber,
    customer_name: normalizeText2(order?.customer_name) || null,
    items,
    subtotal,
    delivery_fee: Math.max(0, finiteNumber(order?.delivery_fee) ?? 0),
    total,
    fulfillment_type: ["pickup", "pos"].includes(fulfillmentMethod) || normalizeLower(order?.source_channel) === "pos" ? "pickup" : "delivery",
    estimated_delivery_date: normalizeText2(order?.requested_delivery_date) || null,
    assigned_delivery_date: normalizeText2(order?.assigned_delivery_date) || null,
    delivery_window_label: normalizeText2(order?.delivery_window_label || order?.requested_time_window) || null,
    delivered_at: normalizeText2(order?.delivered_at) || null,
    delivery_photo_url: normalizeText2(order?.delivery_photo_url) || null,
    delivery_drop_location: normalizeText2(order?.delivery_drop_location) || null,
    status: authoritativeCustomerOrderStatus(order),
    payment_captured: paymentWasCaptured(order),
    payment_status: normalizeLower(order?.payment_status || order?.financial_status) || "paid",
    financial_status: normalizeLower(order?.financial_status || order?.payment_status) || "paid",
    fulfillment_status: normalizeLower(order?.fulfillment_status || order?.shopify_fulfillment_status) || null,
    created_date: normalizeText2(order?.customer_order_date || order?.created_date) || null,
    is_test_order: false,
    is_abandoned_checkout: false,
    source_channel: normalizeLower(order?.source_channel) || "online",
    customer_history_source: "authoritative_shopify_order"
  };
}
async function applyOwnedDeliveryProofToOrderHistory(base44, orders, identityEmails) {
  if (!Array.isArray(orders) || orders.length === 0) return orders;
  const taskRows = uniqueRows((await Promise.all(
    (identityEmails || []).map(normalizeText2).filter(Boolean).map((customerEmail) => safeFilter(
      base44.asServiceRole.entities.FulfillmentTask,
      { customer_email: customerEmail },
      "-created_date",
      100
    ))
  )).flat()).filter((task) => !task?.is_test_task);
  if (taskRows.length === 0) return orders;
  return (orders || []).map((order) => {
    const orderId = normalizeText2(order?.id);
    const orderNumber = normalizeOrderNumber(order?.order_number);
    const linkedTasks = taskRows.filter((task) => {
      const taskOrderNumber = normalizeOrderNumber(task?.order_number || task?.shopify_order_number);
      const linkedIds = [task?.base44_order_id, task?.order_id].map(normalizeText2).filter(Boolean);
      return Boolean(
        orderId && linkedIds.includes(orderId) || orderNumber && taskOrderNumber === orderNumber
      );
    });
    if (linkedTasks.length === 0) return order;
    const status = customerHistoryLifecycleStatus(order, linkedTasks);
    const proofTask = status === "delivered" ? linkedTasks.find((task) => normalizeText2(task?.delivery_photo_url) || normalizeText2(task?.delivery_drop_location)) : null;
    return {
      ...order,
      status,
      ...proofTask ? {
        delivered_at: normalizeText2(order?.delivered_at || proofTask?.delivered_at) || null,
        delivery_photo_url: normalizeText2(order?.delivery_photo_url || proofTask?.delivery_photo_url) || null,
        delivery_drop_location: normalizeText2(order?.delivery_drop_location || proofTask?.delivery_drop_location) || null
      } : {}
    };
  });
}
async function loadOwnedAuthoritativeOrders(base44, identityEmails, profiles) {
  const entity = base44.asServiceRole.entities.ShopifyOrder;
  const normalizedEmails = new Set((identityEmails || []).map(normalizeEmail3).filter(Boolean));
  const normalizedPhones = new Set((profiles || []).map((profile) => normalizePhone(profile?.phone)).filter(Boolean));
  const queries = [];
  for (const email3 of identityEmails || []) {
    const raw = normalizeText2(email3);
    if (raw) queries.push({ customer_email: raw });
    const normalized = normalizeEmail3(raw);
    if (normalized && normalized !== raw) queries.push({ customer_email: normalized });
  }
  for (const profile of profiles || []) {
    for (const phone of phoneQueryVariants(profile?.phone)) queries.push({ customer_phone: phone });
  }
  const rows = uniqueRows((await Promise.all(
    queries.map((query) => safeFilter(entity, query, "-created_date", 100))
  )).flat());
  return rows.filter((row) => {
    const ownedByEmail = normalizedEmails.has(normalizeEmail3(row?.customer_email));
    const rowPhone = normalizePhone(row?.customer_phone);
    const ownedByPhone = Boolean(rowPhone && normalizedPhones.has(rowPhone));
    return (ownedByEmail || ownedByPhone) && paymentWasCaptured(row) && !isExplicitInternalTestOrder(row) && !row?.is_abandoned_checkout;
  });
}
function mergeOwnedAuthoritativeOrderHistory(currentOrders, authoritativeOrders) {
  if (envEnabled(CUSTOMER_ORDER_HISTORY_SOURCE_MERGE_KILL_SWITCH)) return currentOrders;
  const merged = [...currentOrders || []];
  const currentOrderNumbers = new Set(merged.map((order) => normalizeOrderNumber(order?.order_number)).filter(Boolean));
  const currentIds = new Set(merged.map((order) => normalizeText2(order?.id)).filter(Boolean));
  for (const authoritativeOrder of authoritativeOrders || []) {
    const orderNumber = normalizeOrderNumber(authoritativeOrder?.shopify_order_number || authoritativeOrder?.order_number);
    const linkedCustomerOrderId = normalizeText2(authoritativeOrder?.base44_order_id || authoritativeOrder?.customer_app_order_id);
    if (orderNumber && currentOrderNumbers.has(orderNumber) || linkedCustomerOrderId && currentIds.has(linkedCustomerOrderId)) {
      continue;
    }
    const projected = sanitizeAuthoritativeHistoryOrder(authoritativeOrder);
    if (!projected.order_number) continue;
    merged.push(projected);
    currentOrderNumbers.add(projected.order_number);
  }
  return merged.sort((left, right) => {
    const leftTime = Date.parse(left?.created_date || "") || 0;
    const rightTime = Date.parse(right?.created_date || "") || 0;
    return rightTime - leftTime;
  });
}
var CUSTOMER_REWARDS_DISPLAY_TIERS = [
  { name: "Seedling", min: 0, max: 499, next: 500 },
  { name: "Silver", min: 500, max: 999, next: 1e3 },
  { name: "Gold", min: 1e3, max: 2499, next: 2500 },
  { name: "Platinum", min: 2500, max: 4999, next: 5e3 },
  { name: "Elite", min: 5e3, max: Number.POSITIVE_INFINITY, next: null }
];
function customerRewardsLimitedNativeFirstConfig() {
  return {
    enabled: envEnabled(CUSTOMER_REWARDS_NATIVE_FIRST_READS_ENABLE),
    killSwitch: envEnabled(CUSTOMER_REWARDS_NATIVE_FIRST_READS_KILL_SWITCH),
    allowlist: parseIdentifierCsvSet(Deno.env.get(CUSTOMER_REWARDS_NATIVE_FIRST_READS_USER_POINTS_ALLOWLIST))
  };
}
function customerRewardsLimitedNativeReadsActive(config = customerRewardsLimitedNativeFirstConfig()) {
  return Boolean(config.enabled && !config.killSwitch && config.allowlist?.size > 0);
}
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function deriveCustomerRewardsTier(points) {
  const total = finiteNumber(points) ?? 0;
  return CUSTOMER_REWARDS_DISPLAY_TIERS.find((tier) => total >= tier.min && total <= tier.max) || CUSTOMER_REWARDS_DISPLAY_TIERS[0];
}
function analyzeCustomerRewardsHistory(pointsRecord) {
  const history = Array.isArray(pointsRecord?.points_history) ? pointsRecord.points_history : [];
  let malformed = 0;
  let delta = 0;
  let missingIdempotency = 0;
  for (const entry of history) {
    const amount = finiteNumber(entry?.amount);
    if (amount === null) {
      malformed += 1;
      continue;
    }
    delta += amount;
    if (!normalizeText2(entry?.idempotency_key)) missingIdempotency += 1;
  }
  const total = finiteNumber(pointsRecord?.total_points);
  return {
    historyEntryCount: history.length,
    malformedHistoryEntryCount: malformed,
    missingIdempotencyKeyCount: missingIdempotency,
    historyReconstructable: history.length > 0 && malformed === 0,
    reconstructableHistoryDelta: delta,
    balanceHistoryConsistent: total !== null && history.length > 0 && malformed === 0 && total === delta
  };
}
function customerRewardsRepairReplayHold(pointsRecord) {
  const historyText = (Array.isArray(pointsRecord?.points_history) ? pointsRecord.points_history : []).map((entry) => [entry?.description, entry?.event_key, entry?.idempotency_key].map(normalizeLower).join(" ")).join(" ");
  const text = [
    pointsRecord?.description,
    pointsRecord?.sync_status,
    pointsRecord?.source,
    historyText
  ].map(normalizeLower).join(" ");
  return ["repair", "replay", "retry", "recovery", "backfill", "manual_review"].some((token) => text.includes(token));
}
function customerRewardsTierCompatible(pointsRecord, derivedTier) {
  const storedTier = normalizeLower(pointsRecord?.current_tier || pointsRecord?.tier || pointsRecord?.tier_name || pointsRecord?.loyalty_tier);
  if (!storedTier) return true;
  return storedTier === normalizeLower(derivedTier?.name);
}
function customerRewardsCatalogReadiness(activeRewardTiers) {
  const rewards = Array.isArray(activeRewardTiers) ? activeRewardTiers : [];
  const blockers = [];
  const seenDefinitions = /* @__PURE__ */ new Set();
  let duplicateRewardDefinitionCount = 0;
  let invalidRewardCostCount = 0;
  if (rewards.length === 0) blockers.push("static_fallback_catalog_active");
  for (const reward of rewards) {
    const title = normalizeLower(reward?.title);
    const rewardType = normalizeLower(reward?.reward_type);
    const cost = finiteNumber(reward?.points_required);
    const key = `${title}|${rewardType}|${cost ?? "invalid"}`;
    if (!title || !rewardType || cost === null || cost < 0) invalidRewardCostCount += 1;
    if (seenDefinitions.has(key)) duplicateRewardDefinitionCount += 1;
    seenDefinitions.add(key);
  }
  if (duplicateRewardDefinitionCount > 0) blockers.push("duplicate_reward_definition_risk");
  if (invalidRewardCostCount > 0) blockers.push("invalid_reward_cost_risk");
  return {
    ready: blockers.length === 0,
    blockers,
    activeRewardCount: rewards.length,
    duplicateRewardDefinitionCount,
    invalidRewardCostCount
  };
}
function customerRewardsNativeReadEligible(pointsRecord, ownedPointsRows, activeRewardTiers = []) {
  const pointsRows = uniqueRows(ownedPointsRows || []);
  const blockers = [];
  const total = finiteNumber(pointsRecord?.total_points);
  const lifetime = finiteNumber(pointsRecord?.lifetime_points);
  const redeemed = finiteNumber(pointsRecord?.redeemed_points);
  const derivedTier = deriveCustomerRewardsTier(total ?? 0);
  const history = analyzeCustomerRewardsHistory(pointsRecord);
  const catalog = customerRewardsCatalogReadiness(activeRewardTiers);
  if (!pointsRecord) blockers.push("user_points_missing");
  if (pointsRows.length !== 1) blockers.push("duplicate_loyalty_identity_risk");
  if (!normalizeText2(pointsRecord?.id)) blockers.push("internal_user_points_id_missing");
  if (total === null || lifetime === null || redeemed === null) blockers.push("native_balance_missing");
  if ((total ?? 0) < 0 || (lifetime ?? 0) < 0 || (redeemed ?? 0) < 0) blockers.push("negative_or_impossible_points_state");
  if ((lifetime ?? 0) < (redeemed ?? 0)) blockers.push("negative_or_impossible_points_state");
  if (!history.historyReconstructable) blockers.push("points_history_not_reconstructable_for_read_parity");
  if (history.historyReconstructable && !history.balanceHistoryConsistent) blockers.push("native_balance_history_mismatch");
  if (!customerRewardsTierCompatible(pointsRecord, derivedTier)) blockers.push("tier_mismatch_manual_review");
  if (!catalog.ready) blockers.push(...catalog.blockers);
  if (customerRewardsRepairReplayHold(pointsRecord)) blockers.push("repair_replay_hold");
  return {
    eligible: blockers.length === 0,
    blockers: Array.from(new Set(blockers)),
    derivedTier,
    history,
    catalog
  };
}
function sanitizeCustomerRewardsPointsRecord(pointsRecord, eligibility) {
  if (!pointsRecord) return null;
  const total = finiteNumber(pointsRecord.total_points) ?? 0;
  const lifetime = finiteNumber(pointsRecord.lifetime_points) ?? 0;
  const redeemed = finiteNumber(pointsRecord.redeemed_points) ?? 0;
  const tier = eligibility?.derivedTier || deriveCustomerRewardsTier(total);
  const pointsToNextTier = tier.next ? Math.max(0, tier.next - total) : 0;
  const tierProgressPercent = tier.next ? Math.min(100, Math.max(0, (total - tier.min) / (tier.next - tier.min) * 100)) : 100;
  return {
    total_points: total,
    lifetime_points: lifetime,
    redeemed_points: redeemed,
    current_tier: tier.name,
    points_to_next_tier: pointsToNextTier,
    tier_progress_percent: tierProgressPercent
  };
}
function selectLimitedNativeFirstRewardsPointsRecord({ currentPointsRecord, ownedPointsRows, activeRewardTiers, config = customerRewardsLimitedNativeFirstConfig() }) {
  if (!customerRewardsLimitedNativeReadsActive(config)) {
    return { pointsRecord: currentPointsRecord, selected: false, reason: "feature_disabled_or_unconfigured" };
  }
  const ownedRows = uniqueRows(ownedPointsRows || []);
  const allowlistedOwnedRows = ownedRows.filter((row) => config.allowlist.has(normalizeText2(row?.id)));
  if (allowlistedOwnedRows.length !== 1) {
    return { pointsRecord: currentPointsRecord, selected: false, reason: "allowlisted_owned_points_record_not_exactly_one" };
  }
  const candidate = allowlistedOwnedRows[0];
  const eligibility = customerRewardsNativeReadEligible(candidate, ownedRows, activeRewardTiers);
  if (!eligibility.eligible) {
    return { pointsRecord: currentPointsRecord, selected: false, reason: "eligibility_failed" };
  }
  return {
    pointsRecord: sanitizeCustomerRewardsPointsRecord(candidate, eligibility),
    selected: true,
    reason: "limited_native_rewards_read_selected"
  };
}
async function handler6(req) {
  try {
    const base44 = createClientFromRequest6(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const authEmail = user.email;
    console.log("[getCustomerAccountDashboardData] Loading authenticated dashboard");
    const identities = /* @__PURE__ */ new Set([authEmail]);
    const resolvedProfiles = [];
    const seenProfileIds = /* @__PURE__ */ new Set();
    const rememberProfile = (profile) => {
      if (!profile) return;
      const key = normalizeText2(profile.id) || JSON.stringify(profile);
      if (seenProfileIds.has(key)) return;
      seenProfileIds.add(key);
      resolvedProfiles.push(profile);
    };
    const fwdProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    fwdProfiles.forEach(rememberProfile);
    const fwdProfile = fwdProfiles[0] || null;
    if (fwdProfile?.contact_email) identities.add(fwdProfile.contact_email);
    if (fwdProfile?.customer_email) identities.add(fwdProfile.customer_email);
    const revProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    revProfiles.forEach(rememberProfile);
    for (const p of revProfiles) {
      if (p.customer_email) identities.add(p.customer_email);
      if (p.contact_email) identities.add(p.contact_email);
    }
    for (const email3 of [...identities]) {
      if (email3 !== authEmail) {
        const extraProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email3 });
        extraProfiles.forEach(rememberProfile);
        if (extraProfiles[0]?.contact_email) identities.add(extraProfiles[0].contact_email);
        const revExtra = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email3 });
        revExtra.forEach(rememberProfile);
        for (const p of revExtra) {
          if (p.customer_email) identities.add(p.customer_email);
          if (p.contact_email) identities.add(p.contact_email);
        }
      }
    }
    const identityList = [...identities];
    console.log(`[getCustomerAccountDashboardData] Resolved ${identityList.length} identity email(s)`);
    const primaryEmail = fwdProfile?.contact_email || revProfiles[0]?.customer_email || authEmail;
    let customerProfile = fwdProfile;
    if (!customerProfile && revProfiles[0]) {
      customerProfile = revProfiles[0];
    }
    if (!customerProfile) {
      for (const email3 of identityList) {
        const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: email3 });
        profiles.forEach(rememberProfile);
        if (profiles[0]) {
          customerProfile = profiles[0];
          break;
        }
      }
    }
    rememberProfile(customerProfile);
    const allSubs = [];
    const seenSubIds = /* @__PURE__ */ new Set();
    for (const email3 of identityList) {
      const subs = await base44.asServiceRole.entities.Subscription.filter(
        { customer_email: email3 },
        "-created_date",
        50
      );
      for (const sub of subs) {
        const dedupeKey = sub.stripe_subscription_id || sub.id;
        if (!seenSubIds.has(dedupeKey)) {
          seenSubIds.add(dedupeKey);
          allSubs.push(sub);
        }
      }
    }
    const activeSubs = allSubs.filter(
      (s) => s.status === "active" || s.status === "paused"
    );
    const currentRitual = activeSubs.find((s) => s.status === "active") || activeSubs[0] || null;
    const allOrders = [];
    const seenOrderPIs = /* @__PURE__ */ new Set();
    for (const email3 of identityList) {
      const orders = await base44.asServiceRole.entities.Order.filter(
        { customer_email: email3 },
        "-created_date",
        100
      );
      for (const order of orders) {
        const dedupeKey = order.order_number || order.stripe_payment_intent_id || order.id;
        if (!seenOrderPIs.has(dedupeKey)) {
          seenOrderPIs.add(dedupeKey);
          allOrders.push(order);
        }
      }
    }
    const validOrders = allOrders.filter(
      (o) => (o.payment_status === "paid" || o.payment_status === "refunded" || o.payment_captured === true || o.financial_status === "paid" || o.financial_status === "refunded") && !o.is_abandoned_checkout && !o.is_test_order
    );
    let allOrdersForHistory = allOrders.filter((o) => {
      if (o.is_test_order) return false;
      if (o.is_abandoned_checkout) return false;
      const paymentWasCaptured2 = o.payment_captured === true || o.payment_status === "paid" || o.payment_status === "refunded" || o.financial_status === "paid" || o.financial_status === "refunded";
      if (!paymentWasCaptured2) return false;
      return true;
    });
    allOrdersForHistory = await applyLimitedNativeFirstOrderHistory(base44, allOrdersForHistory);
    const authoritativeOrders = await loadOwnedAuthoritativeOrders(base44, identityList, resolvedProfiles);
    allOrdersForHistory = mergeOwnedAuthoritativeOrderHistory(allOrdersForHistory, authoritativeOrders);
    allOrdersForHistory = await applyOwnedDeliveryProofToOrderHistory(base44, allOrdersForHistory, identityList);
    console.log(`[getCustomerAccountDashboardData] sourceOrders=${allOrders.length} sourceValidOrders=${validOrders.length} authoritativeOrders=${authoritativeOrders.length} customerHistoryOrders=${allOrdersForHistory.length}`);
    let creditRecord = null;
    for (const email3 of identityList) {
      const credits = await base44.asServiceRole.entities.NuViraCredit.filter({ customer_email: email3 });
      if (credits[0]) {
        creditRecord = credits[0];
        break;
      }
    }
    let pointsRecord = null;
    let ownedPointsRows = [];
    const rewardsNativeReadConfig = customerRewardsLimitedNativeFirstConfig();
    const rewardsNativeReadActive = customerRewardsLimitedNativeReadsActive(rewardsNativeReadConfig);
    for (const email3 of identityList) {
      const pts = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: email3 });
      if (rewardsNativeReadActive) ownedPointsRows = uniqueRows([...ownedPointsRows, ...pts]);
      if (pts[0] && !pointsRecord) {
        pointsRecord = pts[0];
        if (!rewardsNativeReadActive) break;
      }
    }
    if (rewardsNativeReadActive) {
      const activeRewardTiers = await safeFilter(base44.asServiceRole.entities.RewardTier, { is_active: true }, "sort_order", 20);
      const selectedRewardsRead = selectLimitedNativeFirstRewardsPointsRecord({
        currentPointsRecord: pointsRecord,
        ownedPointsRows,
        activeRewardTiers,
        config: rewardsNativeReadConfig
      });
      pointsRecord = selectedRewardsRead.pointsRecord;
    }
    let unreadCount = 0;
    for (const email3 of identityList) {
      const notifs = await base44.asServiceRole.entities.Notification.filter(
        { customer_email: email3, is_read: false },
        "-created_date",
        50
      );
      unreadCount += notifs.length;
    }
    console.log(`[getCustomerAccountDashboardData] Done. identities=${identityList.length} subs=${allSubs.length} active_subs=${activeSubs.length} orders=${allOrdersForHistory.length} credits=${creditRecord?.balance || 0} pts=${pointsRecord?.total_points || 0}`);
    return Response.json({
      // Identity resolution
      auth_email: authEmail,
      resolved_identity_emails: identityList,
      primary_customer_email: primaryEmail,
      display_email: customerProfile?.contact_email || authEmail,
      // Profile
      customer_profile: customerProfile || null,
      // Subscriptions
      all_subscriptions: allSubs,
      active_subscriptions: activeSubs,
      subscription_count: activeSubs.length,
      current_ritual: currentRitual,
      // Orders
      orders: allOrdersForHistory,
      all_orders_raw: allOrdersForHistory,
      order_count: allOrdersForHistory.length,
      // Credits
      credits: creditRecord?.balance || 0,
      lifetime_credits: creditRecord?.lifetime_issued || 0,
      applied_credits: creditRecord?.lifetime_used || 0,
      credit_record: creditRecord || null,
      // Loyalty
      loyalty_points: pointsRecord?.total_points || 0,
      loyalty_lifetime: pointsRecord?.lifetime_points || 0,
      loyalty_redeemed: pointsRecord?.redeemed_points || 0,
      points_record: pointsRecord || null,
      // Notifications
      notifications_unread_count: unreadCount,
      // Debug
      debug: {
        resolved_identity_emails: identityList,
        active_subscription_ids_found: activeSubs.map((s) => s.stripe_subscription_id || s.id),
        orders_found: allOrdersForHistory.length,
        credits_found: creditRecord?.balance || 0,
        profile_email_displayed: customerProfile?.contact_email || authEmail,
        ritual_card_value: currentRitual ? "Active" : "None",
        data_source: "getCustomerAccountDashboardData"
      }
    });
  } catch (error) {
    console.error("[getCustomerAccountDashboardData] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/getCustomerNotifications/entry.ts
import { createClientFromRequest as createClientFromRequest7 } from "npm:@base44/sdk@0.8.25";
var VALID_ACTIONS = /* @__PURE__ */ new Set(["list", "mark_read", "mark_all_read", "dismiss", "dismiss_read"]);
async function readJsonBody2(req) {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, body: null };
  }
}
function normalizeEmail4(value) {
  return String(value || "").trim().toLowerCase();
}
function ownsNotification(notification, identityEmails) {
  const identities = new Set(identityEmails.map(normalizeEmail4).filter(Boolean));
  return identities.has(normalizeEmail4(notification?.customer_email));
}
function notificationIdFromBody(body) {
  const value = body?.notification_id || body?.mark_read_id || "";
  return typeof value === "string" ? value.trim() : "";
}
async function loadNotifications(base44, identityEmails) {
  const seen = /* @__PURE__ */ new Set();
  const all = [];
  for (const email3 of identityEmails) {
    const batch = await base44.asServiceRole.entities.Notification.filter(
      { customer_email: email3 },
      "-created_date",
      50
    );
    for (const notification of batch) {
      if (!seen.has(notification.id)) {
        seen.add(notification.id);
        all.push(notification);
      }
    }
  }
  return all.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
}
async function updateManyNotifications(base44, notifications, patch) {
  let updatedCount = 0;
  for (const notification of notifications) {
    await base44.asServiceRole.entities.Notification.update(notification.id, patch);
    updatedCount += 1;
  }
  return updatedCount;
}
async function handler7(req) {
  try {
    const base44 = createClientFromRequest7(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    let body = {};
    if (req.method === "POST") {
      const parsedBody = await readJsonBody2(req);
      if (!parsedBody.ok) {
        return Response.json({ success: false, error: "malformed_json", error_code: "malformed_json" }, { status: 400 });
      }
      if (!parsedBody.body || typeof parsedBody.body !== "object" || Array.isArray(parsedBody.body)) {
        return Response.json({ success: false, error: "invalid_request", error_code: "invalid_request" }, { status: 400 });
      }
      body = parsedBody.body;
    }
    const action = body.mark_read_id ? "mark_read" : String(body.action || "list");
    if (!VALID_ACTIONS.has(action)) {
      return Response.json({ success: false, error: "invalid_action", error_code: "invalid_action" }, { status: 400 });
    }
    const identityEmails = await resolveIdentities(base44, user.email);
    if (action === "mark_read" || action === "dismiss") {
      const notificationId = notificationIdFromBody(body);
      if (!notificationId || notificationId.length > 128) {
        return Response.json({ success: false, error: "invalid_notification_id", error_code: "invalid_notification_id" }, { status: 400 });
      }
      const matches = await base44.asServiceRole.entities.Notification.filter({ id: notificationId });
      const notification = matches[0];
      if (!notification) {
        return Response.json({ error: "Notification not found" }, { status: 404 });
      }
      if (!ownsNotification(notification, identityEmails)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      const patch = action === "dismiss" ? { is_read: true, dismissed_at: (/* @__PURE__ */ new Date()).toISOString() } : { is_read: true };
      await base44.asServiceRole.entities.Notification.update(notificationId, patch);
      return Response.json({
        success: true,
        action,
        notification_id: notificationId,
        ...action === "mark_read" ? { marked_read: notificationId } : {}
      });
    }
    const all = await loadNotifications(base44, identityEmails);
    if (action === "mark_all_read") {
      const targets = all.filter((notification) => !notification.dismissed_at && notification.is_read !== true);
      const updatedCount = await updateManyNotifications(base44, targets, { is_read: true });
      return Response.json({ success: true, action, updated_count: updatedCount });
    }
    if (action === "dismiss_read") {
      const targets = all.filter((notification) => !notification.dismissed_at && notification.is_read === true);
      const updatedCount = await updateManyNotifications(base44, targets, { dismissed_at: (/* @__PURE__ */ new Date()).toISOString() });
      return Response.json({ success: true, action, updated_count: updatedCount });
    }
    const notifications = all.filter((notification) => !notification.dismissed_at).slice(0, 50);
    console.log(`[getCustomerNotifications] Returning ${notifications.length} notifications for authenticated account`);
    return Response.json({ notifications, identities_resolved: identityEmails });
  } catch (error) {
    console.error("[getCustomerNotifications] Error:", error.message);
    return Response.json({ error: "Unable to update notifications" }, { status: 500 });
  }
}
async function resolveIdentities(base44, authEmail) {
  const identities = /* @__PURE__ */ new Set([authEmail]);
  try {
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail });
    if (profiles[0]?.contact_email) identities.add(profiles[0].contact_email);
    const reverseProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail });
    for (const profile of reverseProfiles) {
      if (profile.customer_email) identities.add(profile.customer_email);
      if (profile.contact_email) identities.add(profile.contact_email);
    }
  } catch (error) {
    console.warn(`[getCustomerNotifications] Identity resolution partial failure: ${error.message}`);
  }
  return [...identities];
}

// base44/functions/getCustomerAccountDashboardData/handlers/getCustomerOrderDetail/entry.ts
import { createClientFromRequest as createClientFromRequest8 } from "npm:@base44/sdk@0.8.25";
var CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ENABLE = "ENABLE_CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST";
var CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_KILL_SWITCH = "CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_KILL_SWITCH";
var CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ALLOWLIST = "CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST";
async function readJsonBody3(req) {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, body: null };
  }
}
function normalizeText3(value) {
  return String(value ?? "").trim();
}
function normalizeLower2(value) {
  return normalizeText3(value).toLowerCase();
}
function normalizeEmail5(value) {
  return normalizeLower2(value);
}
function normalizePhone2(value) {
  const digits = normalizeText3(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : "";
}
function normalizeOrderNumber2(value) {
  return normalizeText3(value).replace(/^#/, "").toUpperCase();
}
function envEnabled2(name) {
  return ["1", "true", "yes", "on", "enabled"].includes(normalizeLower2(Deno.env.get(name)));
}
function parseCsvSet2(value) {
  return new Set(normalizeText3(value).split(",").map((part) => normalizeOrderNumber2(part)).filter(Boolean));
}
function uniqueRows2(rows) {
  const seen = /* @__PURE__ */ new Set();
  const unique2 = [];
  for (const row of rows || []) {
    const key = row?.id || JSON.stringify(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique2.push(row);
  }
  return unique2;
}
async function safeFilter2(entity, filter, sort = null, limit = 20) {
  if (!entity?.filter) return [];
  try {
    return await entity.filter(filter, sort, limit) || [];
  } catch (error) {
    console.warn("[getCustomerOrderDetail] limited native tracker context read skipped:", error?.message || error);
    return [];
  }
}
function rowTextIncludes2(row, tokens) {
  const text = [
    row?.sync_source,
    row?.triggered_by,
    row?.reason,
    row?.description,
    row?.action,
    row?.hub_action,
    row?.native_parity_status,
    row?.bridge_action,
    row?.source
  ].map(normalizeLower2).join(" ");
  return tokens.some((token) => text.includes(token));
}
function isOpenReviewRow2(row) {
  const status = normalizeLower2(row?.status || row?.queue_visibility_status);
  return row && !["resolved", "archived", "rejected"].includes(status);
}
function looksSubscriptionOrMultiDelivery2(order, nativeOrder, task) {
  const values = [
    order?.order_type,
    order?.source_type,
    order?.fulfillment_mode,
    order?.fulfillment_type,
    nativeOrder?.order_type,
    nativeOrder?.source_type,
    nativeOrder?.source_channel,
    nativeOrder?.fulfillment_mode,
    task?.order_type,
    task?.source_type,
    task?.fulfillment_type
  ].map(normalizeLower2);
  return Boolean(
    order?.is_subscription || nativeOrder?.is_subscription || values.some((value) => value.includes("subscription") || value.includes("multi_delivery") || value.includes("multi-delivery"))
  );
}
function looksRefunded2(order, nativeOrder) {
  return [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    order?.refund_status,
    nativeOrder?.payment_status,
    nativeOrder?.financial_status,
    nativeOrder?.refund_status,
    nativeOrder?.production_status
  ].some((value) => normalizeLower2(value).includes("refund")) || Boolean(order?.refunded_at || nativeOrder?.refunded_at);
}
function looksCancelled2(order, nativeOrder, task) {
  return [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    nativeOrder?.production_status,
    nativeOrder?.order_status,
    nativeOrder?.payment_status,
    task?.status,
    task?.delivery_status
  ].some((value) => ["cancelled", "canceled", "failed", "voided"].includes(normalizeLower2(value)));
}
function hasPaidCaptured2(order) {
  return Boolean(
    order?.payment_captured === true && ["paid", ""].includes(normalizeLower2(order?.payment_status || "paid")) && ["paid", ""].includes(normalizeLower2(order?.financial_status || "paid"))
  );
}
function nativePaymentIsPaid2(nativeOrder, task) {
  const values = [nativeOrder?.payment_status, nativeOrder?.financial_status, task?.payment_status].map(normalizeLower2).filter(Boolean);
  return values.length === 0 || values.every((value) => value === "paid");
}
function mapCustomerStatus(value) {
  const status = normalizeLower2(value);
  const map = {
    new: "order_received",
    pending: "scheduled_for_juicing",
    awaiting_production: "scheduled_for_juicing",
    production_scheduled: "scheduled_for_juicing",
    scheduled: "scheduled_for_juicing",
    scheduled_for_production: "scheduled_for_juicing",
    in_production: "in_production",
    preparing: "in_production",
    bottled: "bottled_packed",
    packed: "bottled_packed",
    ready_for_delivery: "bottled_packed",
    bottled_packed: "bottled_packed",
    out_for_delivery: "out_for_delivery",
    in_transit: "out_for_delivery",
    arriving_soon: "arriving_soon",
    fulfilled: "delivered",
    delivered: "delivered",
    picked_up: "picked_up",
    ready_for_pickup: "ready_for_pickup",
    order_received: "order_received",
    scheduled_for_juicing: "scheduled_for_juicing"
  };
  return map[status] || status;
}
function customerStatusForHubOrder(order) {
  const payment = normalizeLower2(order?.payment_status || order?.financial_status);
  const refund = normalizeLower2(order?.refund_status);
  if (payment === "refunded" || refund.includes("refund") || order?.refunded_at) return "refunded";
  const statusValues = [
    order?.order_status,
    order?.fulfillment_status,
    order?.shopify_fulfillment_status,
    order?.production_status
  ].map(normalizeLower2).filter(Boolean);
  if (statusValues.some((value) => ["cancelled", "canceled", "failed", "voided"].includes(value))) return "cancelled";
  if (statusValues.some((value) => ["fulfilled", "delivered", "picked_up"].includes(value))) {
    return ["pickup", "pos"].includes(normalizeLower2(order?.fulfillment_method)) ? "picked_up" : "delivered";
  }
  const mapped = mapCustomerStatus(order?.order_status || order?.production_status || order?.fulfillment_status);
  if (mapped && mapped !== "not_required") return mapped;
  return normalizeLower2(order?.source_channel) === "pos" ? "picked_up" : "order_received";
}
var DELIVERY_PROGRESS_RANK = Object.freeze({
  order_received: 0,
  scheduled_for_juicing: 1,
  in_production: 2,
  bottled_packed: 3,
  out_for_delivery: 4,
  arriving_soon: 5
});
function customerFulfillmentType(order, hubOrder, tasks = []) {
  const explicitValues = [
    order?.fulfillment_type,
    order?.fulfillment_method,
    hubOrder?.fulfillment_method,
    ...tasks.flatMap((task) => [task?.fulfillment_type, task?.fulfillment_method])
  ].map(normalizeLower2).filter(Boolean);
  const explicit = explicitValues.find((value) => ["delivery", "pickup"].includes(value));
  if (explicit) return explicit;
  return normalizeLower2(hubOrder?.source_channel) === "pos" ? "pickup" : "delivery";
}
function customerTerminalExceptionStatus(order, hubOrder) {
  const payment = normalizeLower2(order?.payment_status || order?.financial_status || hubOrder?.payment_status || hubOrder?.financial_status);
  const refund = normalizeLower2(order?.refund_status || hubOrder?.refund_status);
  if (payment === "refunded" || refund.includes("refund") || order?.refunded_at || hubOrder?.refunded_at) return "refunded";
  const statuses = [
    order?.status,
    order?.order_status,
    hubOrder?.order_status,
    hubOrder?.status
  ].map(normalizeLower2).filter(Boolean);
  if (statuses.some((value) => ["cancelled", "canceled", "voided"].includes(value))) return "cancelled";
  if (statuses.includes("failed")) return "failed";
  return null;
}
function deliveryProgressStatus(value) {
  const status = normalizeLower2(value).replace(/[\s-]+/g, "_");
  const map = {
    confirmed: "order_received",
    paid: "order_received",
    payment_received: "order_received",
    processing: "order_received",
    order_received: "order_received",
    new: "scheduled_for_juicing",
    pending: "scheduled_for_juicing",
    scheduled: "scheduled_for_juicing",
    awaiting_production: "scheduled_for_juicing",
    production_scheduled: "scheduled_for_juicing",
    scheduled_for_production: "scheduled_for_juicing",
    scheduled_for_juicing: "scheduled_for_juicing",
    in_production: "in_production",
    preparing: "in_production",
    producing: "in_production",
    production_started: "in_production",
    bottled: "bottled_packed",
    labeled: "bottled_packed",
    packed: "bottled_packed",
    ready_for_delivery: "bottled_packed",
    route_assigned: "bottled_packed",
    in_cold_storage: "bottled_packed",
    qc_checked: "bottled_packed",
    completed_pending_verification: "bottled_packed",
    verified_logged: "bottled_packed",
    completed: "bottled_packed",
    complete: "bottled_packed",
    fulfilled: "bottled_packed",
    picked_up: "bottled_packed",
    bottled_packed: "bottled_packed",
    assigned_for_delivery: "out_for_delivery",
    on_route: "out_for_delivery",
    in_transit: "out_for_delivery",
    out_for_delivery: "out_for_delivery",
    arriving_soon: "arriving_soon"
  };
  return map[status] || null;
}
function strongestDeliveryProgress(values) {
  return values.map(deliveryProgressStatus).filter(Boolean).sort((left, right) => DELIVERY_PROGRESS_RANK[right] - DELIVERY_PROGRESS_RANK[left])[0] || "order_received";
}
function resolveCustomerLifecycleStatus({ order, hubOrder, tasks = [] }) {
  const terminalException = customerTerminalExceptionStatus(order, hubOrder);
  if (terminalException) return terminalException;
  const fulfillmentType = customerFulfillmentType(order, hubOrder, tasks);
  const orderStatus = mapCustomerStatus(order?.status || order?.order_status || order?.production_status || order?.fulfillment_status);
  const hubStatus = customerStatusForHubOrder(hubOrder);
  if (fulfillmentType === "pickup") {
    const pickupStatus = orderStatus || hubStatus || "order_received";
    if (["delivered", "fulfilled", "completed", "complete", "picked_up"].includes(normalizeLower2(pickupStatus))) return "picked_up";
    return pickupStatus;
  }
  if (order?.delivered_at || hubOrder?.delivered_at) return "delivered";
  const linkedTasks = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
  if (linkedTasks.length > 0) {
    const taskDelivered = (task) => ["delivered"].includes(normalizeLower2(task?.delivery_status)) || ["delivered"].includes(normalizeLower2(task?.status)) || Boolean(task?.delivered_at);
    if (linkedTasks.every(taskDelivered)) return "delivered";
    const taskStatuses = linkedTasks.flatMap((task) => [
      task?.delivery_status,
      task?.status,
      task?.production_status
    ]);
    const safeOrderStatus = ["out_for_delivery", "arriving_soon", "delivered", "picked_up"].includes(normalizeLower2(order?.status)) ? null : order?.status;
    return strongestDeliveryProgress([
      ...taskStatuses,
      order?.delivery_status,
      safeOrderStatus,
      order?.production_status,
      order?.fulfillment_status,
      hubOrder?.delivery_status,
      hubOrder?.production_status,
      hubOrder?.fulfillment_status,
      hubOrder?.order_status
    ]);
  }
  if (orderStatus === "delivered" || hubStatus === "delivered" || order?.delivered_at || hubOrder?.delivered_at) return "delivered";
  return strongestDeliveryProgress([
    order?.delivery_status,
    order?.status,
    order?.production_status,
    order?.fulfillment_status,
    hubOrder?.delivery_status,
    hubOrder?.production_status,
    hubOrder?.fulfillment_status,
    hubOrder?.order_status
  ]);
}
function sanitizeHubOrderForCustomer(order) {
  if (!order) return null;
  const customerStatus = customerStatusForHubOrder(order);
  const rawFulfillmentMethod = normalizeLower2(order.fulfillment_method);
  const fulfillmentMethod = ["picked_up", "ready_for_pickup"].includes(customerStatus) || rawFulfillmentMethod === "pos" || normalizeLower2(order.source_channel) === "pos" ? "pickup" : rawFulfillmentMethod || "delivery";
  return {
    shopify_order_number: normalizeOrderNumber2(order.shopify_order_number || order.order_number),
    customer_name: normalizeText3(order.customer_name) || null,
    line_items: (Array.isArray(order.line_items) ? order.line_items : []).map((item) => ({
      title: normalizeText3(item?.title || item?.name) || "Item",
      variant_title: normalizeText3(item?.variant_title) || null,
      quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : 1,
      price: Number.isFinite(Number(item?.price)) ? Number(item.price) : 0,
      image_url: normalizeText3(item?.image_url) || null
    })),
    fulfillment_method: fulfillmentMethod,
    status: customerStatus,
    production_status: normalizeLower2(order.production_status) || null,
    fulfillment_status: normalizeLower2(order.fulfillment_status || order.shopify_fulfillment_status) || null,
    total_price: Number.isFinite(Number(order.total_price)) ? Number(order.total_price) : 0,
    requested_delivery_date: normalizeText3(order.requested_delivery_date) || null,
    assigned_delivery_date: normalizeText3(order.assigned_delivery_date) || null,
    requested_time_window: customerStatus === "picked_up" ? "Order complete" : normalizeText3(order.requested_time_window) || null,
    delivery_window_label: normalizeText3(order.delivery_window_label) || null,
    delivered_at: normalizeText3(order.delivered_at) || null,
    delivery_photo_url: normalizeText3(order.delivery_photo_url) || null,
    delivery_drop_location: normalizeText3(order.delivery_drop_location) || null
  };
}
function safeCustomerProductionStatus(value) {
  const status = normalizeLower2(value);
  if (!status) return "";
  const blocked = /* @__PURE__ */ new Set(["planned", "completed_pending_verification", "verified_logged"]);
  if (blocked.has(status)) return "";
  return status;
}
function mapFulfillmentStatus2(value) {
  const status = normalizeLower2(value);
  const map = {
    pending_production: "pending",
    pending: "pending",
    scheduled: "pending",
    assigned: "pending",
    ready_for_delivery: "packed",
    packed: "packed",
    bottled_packed: "packed",
    fulfilled: "delivered",
    delivered: "delivered",
    out_for_delivery: "out_for_delivery",
    in_transit: "out_for_delivery",
    cancelled: "cancelled",
    canceled: "cancelled"
  };
  return map[status] || status;
}
function comparableValuesDiffer2(left, right, mapper = (value) => normalizeLower2(value)) {
  const normalizedLeft = mapper(left);
  const normalizedRight = mapper(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft !== normalizedRight;
}
function deliveryDateForOrder2(order) {
  return normalizeText3(order?.assigned_delivery_date || order?.estimated_delivery_date || order?.delivery_date || order?.assigned_delivery_day);
}
function deliveryDateForNative2(nativeOrder, task) {
  return normalizeText3(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || nativeOrder?.requested_delivery_date);
}
function compatibleNativeOrderForCustomerOrder(order, nativeOrder) {
  const orderNumber = normalizeOrderNumber2(order?.order_number);
  const nativeNumber = normalizeOrderNumber2(nativeOrder?.shopify_order_number || nativeOrder?.order_number);
  const idMatches = Boolean(
    order?.id && (nativeOrder?.base44_order_id === order.id || nativeOrder?.customer_app_order_id === order.id)
  );
  const numberMatches = Boolean(orderNumber && nativeNumber && orderNumber === nativeNumber);
  return idMatches || numberMatches;
}
function compatibleTaskForCustomerOrder(order, nativeOrder, task) {
  const orderNumber = normalizeOrderNumber2(order?.order_number);
  const taskNumber = normalizeOrderNumber2(task?.order_number || task?.shopify_order_number);
  const customerLinkMatches = Boolean(
    order?.id && (task?.order_id === order.id || task?.base44_order_id === order.id)
  );
  const nativeLinkMatches = Boolean(
    nativeOrder?.id && (task?.native_shopify_order_id === nativeOrder.id || task?.shopify_order_id === nativeOrder.id)
  );
  const numberMatches = Boolean(orderNumber && taskNumber && orderNumber === taskNumber);
  const compatibleNumber = !orderNumber || !taskNumber || orderNumber === taskNumber;
  return (customerLinkMatches || nativeLinkMatches || numberMatches) && compatibleNumber;
}
async function loadNativeTrackerContext(base44, order) {
  const entities = base44.asServiceRole.entities;
  const orderNumber = normalizeOrderNumber2(order?.order_number);
  const nativeOrderQueries = [];
  if (order?.id) {
    nativeOrderQueries.push({ base44_order_id: order.id });
    nativeOrderQueries.push({ customer_app_order_id: order.id });
  }
  if (orderNumber) {
    nativeOrderQueries.push({ shopify_order_number: orderNumber });
    nativeOrderQueries.push({ shopify_order_number: `#${orderNumber}` });
    nativeOrderQueries.push({ order_number: orderNumber });
    nativeOrderQueries.push({ order_number: `#${orderNumber}` });
  }
  const nativeOrders = uniqueRows2((await Promise.all(nativeOrderQueries.map((query) => safeFilter2(entities.ShopifyOrder, query, null, 5)))).flat()).filter((nativeOrder2) => compatibleNativeOrderForCustomerOrder(order, nativeOrder2));
  const nativeOrder = nativeOrders[0] || null;
  const taskQueries = [];
  if (order?.id) {
    taskQueries.push({ order_id: order.id });
    taskQueries.push({ base44_order_id: order.id });
  }
  if (nativeOrder?.id) {
    taskQueries.push({ native_shopify_order_id: nativeOrder.id });
    taskQueries.push({ shopify_order_id: nativeOrder.id });
  }
  if (orderNumber) {
    taskQueries.push({ order_number: orderNumber });
    taskQueries.push({ order_number: `#${orderNumber}` });
    taskQueries.push({ shopify_order_number: orderNumber });
    taskQueries.push({ shopify_order_number: `#${orderNumber}` });
  }
  const tasks = uniqueRows2((await Promise.all(taskQueries.map((query) => safeFilter2(entities.FulfillmentTask, query, "-created_date", 10)))).flat()).filter((task) => compatibleTaskForCustomerOrder(order, nativeOrder, task));
  const reviewRows = uniqueRows2([
    ...order?.id ? await safeFilter2(entities.OrderReviewQueue, { existing_order_id: order.id }, "-created_date", 10) : [],
    ...orderNumber ? await safeFilter2(entities.OrderReviewQueue, { existing_order_number: orderNumber }, "-created_date", 10) : []
  ]);
  const syncRows = uniqueRows2([
    ...order?.id ? await safeFilter2(entities.OrderSyncLog, { order_id: order.id }, "-created_date", 10) : [],
    ...orderNumber ? await safeFilter2(entities.OrderSyncLog, { order_number: orderNumber }, "-created_date", 10) : []
  ]);
  const parityRows = uniqueRows2([
    ...order?.id ? await safeFilter2(entities.SafeSyncParityLog, { order_id: order.id }, "-created_date", 10) : [],
    ...orderNumber ? await safeFilter2(entities.SafeSyncParityLog, { order_number: orderNumber }, "-created_date", 10) : []
  ]);
  return { nativeOrders, tasks, reviewRows, syncRows, parityRows };
}
function nativeTrackerContextEligible(order, nativeOrders, tasks, reviewRows, syncRows, parityRows) {
  const nativeOrderList = uniqueRows2(nativeOrders);
  const taskList = uniqueRows2(tasks);
  const nativeOrder = nativeOrderList[0] || null;
  const task = taskList[0] || null;
  const blockers = [];
  if (!order) blockers.push("customer_app_order_missing");
  if (nativeOrderList.length !== 1) blockers.push("duplicate_or_missing_native_identity");
  if (taskList.length !== 1) blockers.push("duplicate_or_missing_fulfillment_task_identity");
  if (!nativeOrder) blockers.push("native_shopify_order_missing");
  if (!task) blockers.push("native_fulfillment_task_missing");
  if (nativeOrder && !compatibleNativeOrderForCustomerOrder(order, nativeOrder)) blockers.push("native_shopify_order_identity_conflict");
  if (task && !compatibleTaskForCustomerOrder(order, nativeOrder, task)) blockers.push("native_fulfillment_task_identity_conflict");
  if (looksSubscriptionOrMultiDelivery2(order, nativeOrder, task)) blockers.push("subscription_multi_delivery_hub_source_of_truth");
  if (looksRefunded2(order, nativeOrder)) blockers.push("refund_payment_hub_source_of_truth");
  if (looksCancelled2(order, nativeOrder, task)) blockers.push("cancelled_payment_risk");
  if (!hasPaidCaptured2(order)) blockers.push("payment_not_paid_captured");
  if (!nativePaymentIsPaid2(nativeOrder, task)) blockers.push("payment_mismatch");
  if ((reviewRows || []).some(isOpenReviewRow2)) blockers.push("order_review_queue_hold");
  if ((syncRows || []).some((row) => rowTextIncludes2(row, ["repair", "replay", "retry", "recovery"]))) blockers.push("repair_replay_hold");
  if ((parityRows || []).some((row) => ["mismatch", "blocked", "needs_manual_review"].includes(normalizeLower2(row?.native_parity_status)))) blockers.push("repair_replay_hold");
  const nativeStatus = task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status;
  if (comparableValuesDiffer2(order?.status, nativeStatus, mapCustomerStatus)) blockers.push("status_mismatch");
  const nativePayment = nativeOrder?.payment_status || nativeOrder?.financial_status || task?.payment_status;
  if (comparableValuesDiffer2(order?.payment_status || order?.financial_status, nativePayment)) blockers.push("payment_mismatch");
  const nativeFulfillment = nativeOrder?.fulfillment_status || task?.status;
  if (comparableValuesDiffer2(order?.fulfillment_status, nativeFulfillment, mapFulfillmentStatus2)) blockers.push("fulfillment_mismatch");
  const customerDate = deliveryDateForOrder2(order);
  const nativeDate = deliveryDateForNative2(nativeOrder, task);
  if (customerDate && nativeDate && customerDate !== nativeDate) blockers.push("delivery_schedule_mismatch");
  return {
    eligible: blockers.length === 0,
    blockers: Array.from(new Set(blockers)),
    nativeOrder,
    task
  };
}
function buildNativeTrackerOrderPatch(order, nativeOrder, task) {
  const patch = {};
  const nativeStatus = task?.delivery_status || task?.status || nativeOrder?.production_status || nativeOrder?.order_status;
  const mappedStatus = mapCustomerStatus(nativeStatus);
  if (!order?.status && mappedStatus) patch.status = mappedStatus;
  const productionStatus = safeCustomerProductionStatus(task?.production_status || nativeOrder?.production_status);
  if (productionStatus) patch.production_status = productionStatus;
  const fulfillmentStatus = normalizeText3(nativeOrder?.fulfillment_status || task?.status);
  if (fulfillmentStatus) patch.fulfillment_status = fulfillmentStatus;
  const deliveryStatus = normalizeText3(task?.delivery_status);
  if (deliveryStatus) patch.delivery_status = deliveryStatus;
  const nativeDate = deliveryDateForNative2(nativeOrder, task);
  if (!order?.assigned_delivery_date && nativeDate) patch.assigned_delivery_date = nativeDate;
  if (!order?.estimated_delivery_date && nativeDate) patch.estimated_delivery_date = nativeDate;
  const deliveryWindowLabel = normalizeText3(task?.delivery_window_label || nativeOrder?.delivery_window_label || task?.time_window || nativeOrder?.requested_time_window);
  if (!order?.delivery_window_label && deliveryWindowLabel) patch.delivery_window_label = deliveryWindowLabel;
  return patch;
}
async function applyLimitedNativeFirstTracker(base44, order) {
  if (!envEnabled2(CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ENABLE)) return order;
  if (envEnabled2(CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_KILL_SWITCH)) return order;
  if (!order) return order;
  const allowlist = parseCsvSet2(Deno.env.get(CUSTOMER_ORDER_TRACKER_NATIVE_FIRST_ALLOWLIST));
  const orderNumber = normalizeOrderNumber2(order?.order_number);
  if (!orderNumber || !allowlist.has(orderNumber)) return order;
  const context = await loadNativeTrackerContext(base44, order);
  const eligibility = nativeTrackerContextEligible(order, context.nativeOrders, context.tasks, context.reviewRows, context.syncRows, context.parityRows);
  if (!eligibility.eligible) return order;
  return {
    ...order,
    ...buildNativeTrackerOrderPatch(order, eligibility.nativeOrder, eligibility.task)
  };
}
async function handler8(req) {
  try {
    const base44 = createClientFromRequest8(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const parsedBody = await readJsonBody3(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: "malformed_json", error_code: "malformed_json" }, { status: 400 });
    }
    const body = parsedBody.body;
    const {
      order_number,
      order_id,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      source = "order_history"
      // 'order_history' | 'post_checkout' | 'notification' | 'account'
    } = body;
    const debugPath = [];
    const resolvedEmails = /* @__PURE__ */ new Set([user.email]);
    const resolvedProfiles = [];
    const seenProfileIds = /* @__PURE__ */ new Set();
    const rememberProfile = (profile) => {
      if (!profile) return;
      const key = normalizeText3(profile.id) || JSON.stringify(profile);
      if (seenProfileIds.has(key)) return;
      seenProfileIds.add(key);
      resolvedProfiles.push(profile);
    };
    const [primaryProfiles, contactProfiles] = await Promise.all([
      base44.asServiceRole.entities.UserProfile.filter({ customer_email: user.email }, null, 10),
      base44.asServiceRole.entities.UserProfile.filter({ contact_email: user.email }, null, 10)
    ]);
    for (const p of [...primaryProfiles, ...contactProfiles]) {
      rememberProfile(p);
      if (p.customer_email) resolvedEmails.add(p.customer_email);
      if (p.contact_email) resolvedEmails.add(p.contact_email);
    }
    for (const email3 of [...resolvedEmails]) {
      const aliases = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: email3 }, null, 10);
      for (const a of aliases) {
        rememberProfile(a);
        if (a.customer_email) resolvedEmails.add(a.customer_email);
      }
    }
    const emailList = [...resolvedEmails];
    const normalizedEmailList = new Set(emailList.map(normalizeEmail5).filter(Boolean));
    const normalizedPhoneList = new Set(resolvedProfiles.map((profile) => normalizePhone2(profile?.phone)).filter(Boolean));
    const orderBelongsToCustomer = (candidate) => {
      if (!candidate) return false;
      const emailMatches = normalizedEmailList.has(normalizeEmail5(candidate.customer_email));
      const phone = normalizePhone2(candidate.customer_phone || candidate.contact_phone);
      return emailMatches || Boolean(phone && normalizedPhoneList.has(phone));
    };
    debugPath.push(`resolved_identity_count: ${emailList.length}`);
    let order = null;
    let lookupSource = null;
    if (!order && order_number) {
      debugPath.push("trying: CA Order by order_number");
      const rows = await base44.asServiceRole.entities.Order.filter({ order_number }, null, 1).catch(() => []);
      if (rows[0]) {
        order = rows[0];
        lookupSource = "ca_order_by_number";
      }
    }
    if (!order && order_id && !order_id.startsWith("NV-") && !order_id.startsWith("nv-")) {
      debugPath.push("trying: CA Order by order_id");
      const rows = await base44.asServiceRole.entities.Order.filter({ id: order_id }, null, 1).catch(() => []);
      if (rows[0]) {
        order = rows[0];
        lookupSource = "ca_order_by_id";
      }
    }
    if (!order && order_id && (order_id.startsWith("NV-") || order_id.startsWith("nv-"))) {
      debugPath.push("trying: CA Order by order_id-as-order_number");
      const rows = await base44.asServiceRole.entities.Order.filter({ order_number: order_id.toUpperCase() }, null, 1).catch(() => []);
      if (rows[0]) {
        order = rows[0];
        lookupSource = "ca_order_by_number_fallback";
      }
    }
    if (!order && stripe_payment_intent_id) {
      debugPath.push("trying: CA Order by stripe_payment_intent_id");
      const rows = await base44.asServiceRole.entities.Order.filter({ stripe_payment_intent_id }, null, 1);
      if (rows[0]) {
        order = rows[0];
        lookupSource = "ca_order_by_pi";
      }
    }
    if (!order && stripe_checkout_session_id) {
      debugPath.push("trying: CA Order by stripe_checkout_session_id");
      const rows = await base44.asServiceRole.entities.Order.filter({ stripe_checkout_session_id }, null, 1);
      if (rows[0]) {
        order = rows[0];
        lookupSource = "ca_order_by_session";
      }
    }
    if (order && user.role !== "admin") {
      if (!orderBelongsToCustomer(order)) {
        debugPath.push("SECURITY: order identity did not match \u2014 blocked");
        return Response.json({ found: false, error: "Not authorized", debug_lookup_path: debugPath }, { status: 403 });
      }
    }
    let hubOrder = null;
    if (!order) {
      debugPath.push("CA Order not found \u2014 trying Hub ShopifyOrder fallback");
      const searchNum = normalizeOrderNumber2(order_number || null);
      const searchId = order_id || null;
      const hubRows = await (async () => {
        if (searchNum) {
          const rows = await Promise.all([
            base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: searchNum }, null, 5),
            base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: `#${searchNum}` }, null, 5)
          ]);
          return uniqueRows2(rows.flat());
        }
        if (searchId) return base44.asServiceRole.entities.ShopifyOrder.filter({ base44_order_id: searchId }, null, 5);
        return [];
      })();
      for (const h of hubRows) {
        if (user.role === "admin" || orderBelongsToCustomer(h)) {
          hubOrder = h;
          lookupSource = "hub_shopify_order";
          debugPath.push("found: Hub ShopifyOrder");
          break;
        }
      }
    }
    const resolvedOrderId = order?.id || hubOrder?.base44_order_id;
    const resolvedOrderNumber = order?.order_number || hubOrder?.shopify_order_number || order_number;
    let fulfillmentTasks = [];
    let deliveryProofTasks = [];
    if (resolvedOrderId || resolvedOrderNumber) {
      fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.filter(
        resolvedOrderId ? { order_id: resolvedOrderId } : { order_id: "NONE_USE_NUMBER" },
        "-created_date",
        10
      ).catch(() => []);
      deliveryProofTasks = fulfillmentTasks;
      const primaryTaskHasProof = fulfillmentTasks.some((task) => normalizeText3(task?.delivery_photo_url) || normalizeText3(task?.delivery_drop_location));
      if (!primaryTaskHasProof) {
        const taskQueries = [];
        if (resolvedOrderId) taskQueries.push({ base44_order_id: resolvedOrderId });
        if (resolvedOrderNumber) {
          const taskOrderNumber = normalizeOrderNumber2(resolvedOrderNumber);
          taskQueries.push({ order_number: taskOrderNumber });
          taskQueries.push({ order_number: `#${taskOrderNumber}` });
          taskQueries.push({ shopify_order_number: taskOrderNumber });
          taskQueries.push({ shopify_order_number: `#${taskOrderNumber}` });
        }
        deliveryProofTasks = uniqueRows2([...fulfillmentTasks, ...(await Promise.all(
          taskQueries.map((query) => safeFilter2(base44.asServiceRole.entities.FulfillmentTask, query, "-created_date", 10))
        )).flat()]);
      }
      debugPath.push(`fulfillment_tasks: ${fulfillmentTasks.length}`);
    }
    let syncLog = null;
    if (resolvedOrderNumber) {
      const logRows = await base44.asServiceRole.entities.OrderSyncLog.filter(
        { order_number: resolvedOrderNumber },
        "-created_date",
        1
      ).catch(() => []);
      syncLog = logRows[0] || null;
    }
    order = await applyLimitedNativeFirstTracker(base44, order);
    if (!order && !hubOrder) {
      debugPath.push("not found in any source");
      const isRecentPostCheckout = source === "post_checkout" && (stripe_payment_intent_id || stripe_checkout_session_id);
      return Response.json({
        found: false,
        is_recent_checkout_pending: isRecentPostCheckout,
        source_record: null,
        order: null,
        hub_order: null,
        fulfillment_tasks: [],
        resolved_identity_emails: emailList,
        debug_lookup_path: debugPath,
        sync_log: syncLog ? { status: syncLog.status, hub_action: syncLog.hub_action } : null
      });
    }
    const STATUS_LABELS = {
      order_received: "Order Received",
      scheduled_for_juicing: "Scheduled for Juicing",
      scheduled_for_production: "Scheduled for Production",
      in_production: "In Production",
      bottled_packed: "Bottled & Packed",
      out_for_delivery: "Out for Delivery",
      arriving_soon: "Arriving Soon",
      delivered: "Delivered",
      ready_for_pickup: "Order Ready",
      picked_up: "Order Complete",
      cancelled: "Cancelled",
      refunded: "Refunded",
      failed: "Payment Failed",
      pending_payment: "Pending Payment"
    };
    const TERMINAL_STATUSES2 = ["delivered", "picked_up", "cancelled", "refunded", "failed"];
    const orderStatus = resolveCustomerLifecycleStatus({ order, hubOrder, tasks: deliveryProofTasks });
    const isTerminal = TERMINAL_STATUSES2.includes(orderStatus);
    const deliveryProofTask = deliveryProofTasks.find((task) => normalizeText3(task?.delivery_photo_url) || normalizeText3(task?.delivery_drop_location)) || null;
    const statusTimeline = (order?.status_history || []).map((h) => ({
      status: h.status,
      label: STATUS_LABELS[h.status] || h.status,
      timestamp: h.timestamp,
      message: h.message
    }));
    const deliveryStatus = {
      status: orderStatus,
      label: STATUS_LABELS[orderStatus] || orderStatus,
      delivered_at: order?.delivered_at || hubOrder?.delivered_at || deliveryProofTask?.delivered_at || null,
      delivery_photo_url: order?.delivery_photo_url || hubOrder?.delivery_photo_url || deliveryProofTask?.delivery_photo_url || null,
      delivery_drop_location: order?.delivery_drop_location || hubOrder?.delivery_drop_location || deliveryProofTask?.delivery_drop_location || null,
      assigned_delivery_date: order?.assigned_delivery_date || order?.estimated_delivery_date || hubOrder?.assigned_delivery_date || hubOrder?.requested_delivery_date || null,
      delivery_window_label: order?.delivery_window_label || hubOrder?.delivery_window_label || hubOrder?.requested_time_window || null
    };
    const customerVisibleStatus = (() => {
      if (orderStatus === "delivered") return "Delivered \u2713";
      if (orderStatus === "picked_up") return "Order Complete \u2713";
      if (orderStatus === "cancelled") return "Cancelled";
      if (orderStatus === "refunded") return "Refunded";
      if (orderStatus === "failed") return "Payment Failed";
      if (orderStatus === "out_for_delivery") return "Out for Delivery";
      if (orderStatus === "arriving_soon") return "Arriving Soon";
      if (orderStatus === "in_production") return "In Production";
      if (orderStatus === "bottled_packed") return "Bottled & Packed";
      if (orderStatus === "scheduled_for_juicing") return "Scheduled for Juicing";
      if (orderStatus === "scheduled_for_production") return "Scheduled for Production";
      return STATUS_LABELS[orderStatus] || "Processing";
    })();
    return Response.json({
      found: true,
      source_record: lookupSource,
      order: order || null,
      hub_order: sanitizeHubOrderForCustomer(hubOrder),
      fulfillment_tasks: fulfillmentTasks,
      status_timeline: statusTimeline,
      delivery_status: deliveryStatus,
      customer_visible_status: customerVisibleStatus,
      is_terminal: isTerminal,
      is_recent_checkout_pending: false,
      resolved_identity_emails: emailList,
      debug_lookup_path: debugPath
    });
  } catch (error) {
    console.error("getCustomerOrderDetail error:", error.message);
    return Response.json({
      found: false,
      is_recent_checkout_pending: false,
      reason: "ORDER_LOOKUP_ERROR",
      error: error.message,
      source_record: null,
      order: null,
      hub_order: null,
      fulfillment_tasks: []
    }, { status: 200 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/getDeliveryEta/entry.ts
import { createClientFromRequest as createClientFromRequest9 } from "npm:@base44/sdk@0.8.25";

// base44/functions/getCustomerAccountDashboardData/handlers/getDeliveryEta/deliverySnapshot.ts
var ROUTE_ORIGIN = "619 N Main St Unit 3, O'Fallon, MO 63366";
var CENTRAL_TIME_ZONE = "America/Chicago";
var ON_ROUTE_STATUSES = /* @__PURE__ */ new Set(["out_for_delivery", "arriving_soon"]);
var ROUTE_STATUSES = /* @__PURE__ */ new Set(["out_for_delivery", "arriving_soon", "delivered"]);
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["delivered", "cancelled", "canceled", "refunded", "failed"]);
var DWELL_PER_STOP_SECONDS = 150;
var FALLBACK_LEG_SECONDS = 15 * 60;
var ETA_WINDOW_SECONDS = 20 * 60;
function normalizeSingleLine(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
function normalizeStatus(value) {
  return normalizeSingleLine(value).toLowerCase().replace(/\s+/g, "_");
}
function normalizeOrderNumber3(value) {
  return normalizeSingleLine(value).replace(/^#/, "").toUpperCase();
}
function normalizeDate(value) {
  const text = normalizeSingleLine(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
}
function parseDate(value) {
  const timestamp = Date.parse(normalizeSingleLine(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}
function centralCalendarDate(value) {
  const timestamp = parseDate(value);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CENTRAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
}
function safeAddress(value) {
  if (typeof value === "string") return normalizeSingleLine(value).slice(0, 320);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = value;
  return [
    address.address_line1 || address.line1 || address.street,
    address.address_line2 || address.line2,
    address.city,
    address.state,
    address.postal_code || address.zip
  ].map(normalizeSingleLine).filter(Boolean).join(", ").slice(0, 320);
}
function taskAddress(task) {
  if (!task) return "";
  return safeAddress(task.address) || safeAddress(task.delivery_address) || [task.address_line1, task.address_line2, task.address_city, task.address_state, task.address_postal_code].map(normalizeSingleLine).filter(Boolean).join(", ").slice(0, 320);
}
function orderAddress(order, task) {
  return safeAddress(order.delivery_address) || safeAddress(order.address) || taskAddress(task);
}
function isDelivery(order, task) {
  const value = normalizeStatus(order.fulfillment_type || task?.fulfillment_type || task?.source_type);
  return value.includes("delivery") || value.includes("driver");
}
function resolveTaskOrderKey(task) {
  return [
    normalizeSingleLine(task.base44_order_id),
    normalizeSingleLine(task.customer_app_order_id),
    normalizeSingleLine(task.order_id),
    normalizeOrderNumber3(task.order_number || task.shopify_order_number)
  ].filter(Boolean);
}
function latestTaskByOrder(orders, tasks) {
  const orderByKey = /* @__PURE__ */ new Map();
  for (const order of orders) {
    const keys = [normalizeSingleLine(order.id), normalizeOrderNumber3(order.order_number)].filter(Boolean);
    for (const key of keys) orderByKey.set(key, order);
  }
  const taskByOrderId = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    const order = resolveTaskOrderKey(task).map((key) => orderByKey.get(key)).find(Boolean);
    if (!order?.id) continue;
    const current = taskByOrderId.get(order.id);
    if (!current || parseDate(task.updated_date || task.created_date) > parseDate(current.updated_date || current.created_date)) {
      taskByOrderId.set(order.id, task);
    }
  }
  return taskByOrderId;
}
function resolvedStatus(order, task) {
  const taskStatus = normalizeStatus(task?.delivery_status || task?.status);
  const orderStatus = normalizeStatus(order.status);
  if (ROUTE_STATUSES.has(taskStatus) || TERMINAL_STATUSES.has(taskStatus)) return taskStatus;
  return orderStatus || taskStatus || "order_received";
}
function resolvedDeliveryDate(order, task) {
  return normalizeDate(
    order.estimated_delivery_date || order.assigned_delivery_date || task?.delivery_date || task?.assigned_delivery_date || task?.scheduled_date
  );
}
function routeSequence(task) {
  const value = Number(task?.route_stop_sequence);
  return Number.isFinite(value) && value > 0 ? value : null;
}
function formatTime(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CENTRAL_TIME_ZONE
  });
}
function activitySnapshot({
  order,
  status,
  now,
  routeTotal = 0,
  stopsDelivered = 0,
  stopsAhead = 0,
  stopsRemaining = 0,
  etaSeconds = null
}) {
  const timestamp = Math.floor(now.getTime() / 1e3);
  const orderNumber = normalizeOrderNumber3(order.order_number);
  const delivered = status === "delivered";
  const onRoute = ON_ROUTE_STATUSES.has(status) && isDelivery(order);
  const etaStart = onRoute && Number.isFinite(etaSeconds) ? new Date(now.getTime() + Math.max(0, etaSeconds - ETA_WINDOW_SECONDS) * 1e3) : null;
  const etaEnd = onRoute && Number.isFinite(etaSeconds) ? new Date(now.getTime() + (etaSeconds + ETA_WINDOW_SECONDS) * 1e3) : null;
  const targetStopCount = Math.max(1, stopsDelivered + stopsAhead + 1);
  const progress = delivered ? 100 : onRoute ? Math.max(12, Math.min(92, Math.round(stopsDelivered / targetStopCount * 100))) : 0;
  const statusLabel = delivered ? "Delivered" : onRoute ? "Out for Delivery" : "Delivery not active";
  const message = delivered ? "Your NuVira delivery is complete." : onRoute && stopsAhead === 0 ? "Your driver is headed to your stop next." : onRoute ? `${stopsAhead} stop${stopsAhead === 1 ? "" : "s"} ahead of yours.` : "Live delivery tracking will appear when your route begins.";
  return {
    schema_version: 1,
    order_id: normalizeSingleLine(order.id),
    order_number: orderNumber,
    deep_link: orderNumber ? `/order-tracker/${encodeURIComponent(orderNumber)}` : "/account/orders",
    fulfillment_type: isDelivery(order) ? "delivery" : normalizeStatus(order.fulfillment_type),
    status,
    activity_state: delivered ? "delivered" : onRoute ? "en_route" : "inactive",
    activity_eligible: onRoute,
    on_route: onRoute,
    status_label: statusLabel,
    message,
    eta_window: etaStart && etaEnd ? `${formatTime(etaStart)} - ${formatTime(etaEnd)}` : null,
    eta_start: etaStart?.toISOString() || null,
    eta_end: etaEnd?.toISOString() || null,
    eta_start_epoch: etaStart ? Math.floor(etaStart.getTime() / 1e3) : null,
    eta_end_epoch: etaEnd ? Math.floor(etaEnd.getTime() / 1e3) : null,
    stops_ahead: onRoute ? stopsAhead : 0,
    stops_remaining: onRoute ? stopsRemaining : 0,
    stops_total: routeTotal,
    stops_delivered: delivered ? routeTotal : stopsDelivered,
    progress_percent: progress,
    updated_at: now.toISOString(),
    sequence: timestamp,
    stale_at: new Date(now.getTime() + 12 * 60 * 1e3).toISOString(),
    stale_at_epoch: timestamp + 12 * 60,
    privacy_label: "Route progress only. Precise driver location is not shared."
  };
}
function genericOnRouteSnapshot(order, status, now) {
  return activitySnapshot({
    order,
    status,
    now,
    routeTotal: 1,
    stopsDelivered: 0,
    stopsAhead: 0,
    stopsRemaining: 1,
    etaSeconds: 25 * 60
  });
}
function durationSeconds(leg) {
  const value = normalizeSingleLine(leg?.duration).replace(/s$/, "");
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : FALLBACK_LEG_SECONDS;
}
function safeDistanceTelemetrySnapshot(snapshot, order, status, now) {
  const orderId = normalizeSingleLine(order.id);
  const orderNumber = normalizeOrderNumber3(order.order_number);
  if (normalizeSingleLine(snapshot?.order_id) !== orderId || normalizeOrderNumber3(snapshot?.order_number) !== orderNumber) return null;
  const progress = Number(snapshot.progress_percent);
  const etaStartEpoch = Number(snapshot.eta_start_epoch);
  const etaEndEpoch = Number(snapshot.eta_end_epoch);
  if (!Number.isFinite(progress) || progress < 12 || progress > 94) return null;
  if (!Number.isFinite(etaStartEpoch) || !Number.isFinite(etaEndEpoch) || etaEndEpoch <= etaStartEpoch) return null;
  return {
    schema_version: 2,
    order_id: orderId,
    order_number: orderNumber,
    deep_link: `/order-tracker/${encodeURIComponent(orderNumber)}`,
    fulfillment_type: "delivery",
    status,
    activity_state: "en_route",
    activity_eligible: true,
    on_route: true,
    status_label: "Out for Delivery",
    message: normalizeSingleLine(snapshot.message).slice(0, 160) || "Your NuVira delivery is moving your way.",
    eta_window: normalizeSingleLine(snapshot.eta_window).slice(0, 80) || null,
    eta_start: normalizeSingleLine(snapshot.eta_start).slice(0, 80) || null,
    eta_end: normalizeSingleLine(snapshot.eta_end).slice(0, 80) || null,
    eta_start_epoch: etaStartEpoch,
    eta_end_epoch: etaEndEpoch,
    stops_ahead: Math.max(0, Number(snapshot.stops_ahead) || 0),
    stops_remaining: Math.max(1, Number(snapshot.stops_remaining) || 1),
    stops_total: Math.max(1, Number(snapshot.stops_total) || 1),
    stops_delivered: Math.max(0, Number(snapshot.stops_delivered) || 0),
    progress_percent: Math.round(progress),
    progress_source: "distance_eta",
    updated_at: normalizeSingleLine(snapshot.updated_at).slice(0, 80) || now.toISOString(),
    sequence: Math.max(0, Number(snapshot.sequence) || Math.floor(now.getTime() / 1e3)),
    stale_at: normalizeSingleLine(snapshot.stale_at).slice(0, 80) || new Date(now.getTime() + 3 * 60 * 1e3).toISOString(),
    stale_at_epoch: Math.max(0, Number(snapshot.stale_at_epoch) || Math.floor((now.getTime() + 3 * 60 * 1e3) / 1e3)),
    privacy_label: "Route progress only. Precise driver location is not shared."
  };
}
async function freshDistanceTelemetrySnapshot(base44, order, status, now) {
  if (!ON_ROUTE_STATUSES.has(status) || !isDelivery(order)) return null;
  const entity = base44?.asServiceRole?.entities?.DeliveryRouteTelemetry;
  if (!entity || typeof entity.filter !== "function") return null;
  try {
    const rows = await entity.filter({ state: "active" }, "-last_sample_at", 30);
    for (const row of rows) {
      const lastSample = parseDate(row.last_sample_at);
      const expiresAt = parseDate(row.expires_at);
      if (!lastSample || now.getTime() - lastSample > 3 * 60 * 1e3 || expiresAt && expiresAt <= now.getTime()) continue;
      const snapshot = (Array.isArray(row.snapshots) ? row.snapshots : []).find((candidate) => normalizeSingleLine(candidate?.order_id) === normalizeSingleLine(order.id));
      const safe = snapshot ? safeDistanceTelemetrySnapshot(snapshot, order, status, now) : null;
      if (safe) return safe;
    }
  } catch {
  }
  return null;
}
async function buildDeliveryRouteSnapshots({
  base44,
  anchorOrderId,
  googleMapsApiKey = "",
  now = /* @__PURE__ */ new Date()
}) {
  const orders = await base44.asServiceRole.entities.Order.list("-created_date", 500);
  const anchorOrder = orders.find((order) => order.id === anchorOrderId) || null;
  if (!anchorOrder) return { anchor_order: null, anchor_snapshot: null, route_snapshots: [], route_orders: [] };
  const tasks = await base44.asServiceRole.entities.FulfillmentTask.list("-created_date", 500).catch(() => []);
  const taskByOrderId = latestTaskByOrder(orders, Array.isArray(tasks) ? tasks : []);
  const anchorTask = taskByOrderId.get(anchorOrder.id) || null;
  const anchorStatus = resolvedStatus(anchorOrder, anchorTask);
  const routeDate = resolvedDeliveryDate(anchorOrder, anchorTask) || now.toISOString().slice(0, 10);
  const anchorRouteId = normalizeSingleLine(anchorTask?.route_id);
  if (!isDelivery(anchorOrder, anchorTask) || !ROUTE_STATUSES.has(anchorStatus) && !ON_ROUTE_STATUSES.has(anchorStatus)) {
    const inactive = activitySnapshot({ order: anchorOrder, status: anchorStatus, now });
    return { anchor_order: anchorOrder, anchor_snapshot: inactive, route_snapshots: [inactive], route_orders: [anchorOrder], route_date: routeDate };
  }
  const distanceTelemetry = await freshDistanceTelemetrySnapshot(base44, anchorOrder, anchorStatus, now);
  if (distanceTelemetry) {
    return {
      anchor_order: anchorOrder,
      anchor_snapshot: distanceTelemetry,
      route_snapshots: [distanceTelemetry],
      route_orders: [anchorOrder],
      route_date: routeDate
    };
  }
  const routeRecords = orders.map((order) => {
    const task = taskByOrderId.get(order.id) || null;
    return {
      order,
      task,
      status: resolvedStatus(order, task),
      deliveryDate: resolvedDeliveryDate(order, task),
      operationalDate: resolvedDeliveryDate(order, task) || centralCalendarDate(task?.updated_date || task?.created_date || order.updated_date || order.created_date),
      routeId: normalizeSingleLine(task?.route_id),
      address: orderAddress(order, task),
      sequence: routeSequence(task)
    };
  }).filter((record) => isDelivery(record.order, record.task) && ROUTE_STATUSES.has(record.status) && record.address && (anchorRouteId ? record.routeId === anchorRouteId : record.operationalDate === routeDate));
  if (!routeRecords.some((record) => record.order.id === anchorOrder.id)) {
    const generic = genericOnRouteSnapshot(anchorOrder, anchorStatus, now);
    return { anchor_order: anchorOrder, anchor_snapshot: generic, route_snapshots: [generic], route_orders: [anchorOrder], route_date: routeDate };
  }
  const delivered = routeRecords.filter((record) => record.status === "delivered").sort((left, right) => parseDate(left.task?.delivered_at || left.order.delivered_at || left.order.updated_date) - parseDate(right.task?.delivered_at || right.order.delivered_at || right.order.updated_date));
  const remaining = routeRecords.filter((record) => record.status !== "delivered");
  const allRemainingSequenced = remaining.length > 0 && remaining.every((record) => record.sequence !== null);
  const orderedRemaining = allRemainingSequenced ? [...remaining].sort((left, right) => left.sequence - right.sequence) : [...remaining];
  let cumulativeByOrderId = /* @__PURE__ */ new Map();
  let finalOrder = orderedRemaining;
  if (orderedRemaining.length > 0 && googleMapsApiKey) {
    const routeOrigin = delivered.length > 0 ? delivered[delivered.length - 1].address : ROUTE_ORIGIN;
    try {
      const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleMapsApiKey,
          "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.legs"
        },
        body: JSON.stringify({
          origin: { address: routeOrigin },
          destination: { address: ROUTE_ORIGIN },
          intermediates: orderedRemaining.map((record) => ({ address: record.address })),
          travelMode: "DRIVE",
          optimizeWaypointOrder: !allRemainingSequenced,
          routingPreference: "TRAFFIC_AWARE"
        })
      });
      const data = await response.json().catch(() => ({}));
      const route = response.ok && Array.isArray(data?.routes) ? data.routes[0] : null;
      if (route) {
        const indexes = Array.isArray(route.optimizedIntermediateWaypointIndex) ? route.optimizedIntermediateWaypointIndex : orderedRemaining.map((_, index) => index);
        finalOrder = indexes.map((index) => orderedRemaining[index]).filter(Boolean);
        let cumulative = 0;
        finalOrder.forEach((record, index) => {
          cumulative += durationSeconds(route.legs?.[index]);
          cumulativeByOrderId.set(record.order.id, cumulative);
        });
      } else {
        console.warn(`[deliverySnapshot] Routes API unavailable status=${response.status}`);
      }
    } catch {
      console.warn("[deliverySnapshot] Routes API request failed; using safe fallback timing");
    }
  }
  if (cumulativeByOrderId.size === 0) {
    let cumulative = 0;
    finalOrder.forEach((record) => {
      cumulative += FALLBACK_LEG_SECONDS;
      cumulativeByOrderId.set(record.order.id, cumulative);
    });
  }
  const deliveredSnapshots = delivered.map((record) => activitySnapshot({
    order: record.order,
    status: "delivered",
    now,
    routeTotal: routeRecords.length,
    stopsDelivered: routeRecords.length
  }));
  const activeSnapshots = finalOrder.map((record, index) => activitySnapshot({
    order: record.order,
    status: record.status,
    now,
    routeTotal: routeRecords.length,
    stopsDelivered: delivered.length,
    stopsAhead: index,
    stopsRemaining: finalOrder.length,
    etaSeconds: (cumulativeByOrderId.get(record.order.id) || FALLBACK_LEG_SECONDS) + index * DWELL_PER_STOP_SECONDS
  }));
  const routeSnapshots = [...deliveredSnapshots, ...activeSnapshots];
  const anchorSnapshot = routeSnapshots.find((snapshot) => snapshot.order_id === anchorOrder.id) || genericOnRouteSnapshot(anchorOrder, anchorStatus, now);
  return {
    anchor_order: anchorOrder,
    anchor_snapshot: anchorSnapshot,
    route_snapshots: routeSnapshots,
    route_orders: routeRecords.map((record) => record.order),
    route_date: routeDate
  };
}

// base44/functions/getCustomerAccountDashboardData/handlers/getDeliveryEta/entry.ts
function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.replace(/\s+/g, " ").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]").replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[redacted phone]").replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "[redacted auth]").replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, "[redacted secret]").slice(0, 180);
}
async function readJsonBody4(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
function authorizeOrderAccess(user, order) {
  const requester = String(user.email || "").trim().toLowerCase();
  const owner = String(order?.customer_email || "").trim().toLowerCase();
  return user.role === "admin" || user.role === "owner" || user.role === "driver" || requester === owner;
}
async function handler9(req) {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  try {
    const base44 = createClientFromRequest9(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: "unauthorized" }, { status: 401 });
    const body = await readJsonBody4(req);
    if (!body) return Response.json({ error: "malformed_json" }, { status: 400 });
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    if (!orderId || orderId.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(orderId)) {
      return Response.json({ error: "order_id required" }, { status: 400 });
    }
    const ownedOrderRows = await base44.asServiceRole.entities.Order.filter({ id: orderId }, void 0, 1);
    const ownedOrder = ownedOrderRows[0] || null;
    if (!ownedOrder) return Response.json({ error: "Order not found" }, { status: 404 });
    if (!authorizeOrderAccess(user, ownedOrder)) return Response.json({ error: "forbidden" }, { status: 403 });
    const result = await buildDeliveryRouteSnapshots({
      base44,
      anchorOrderId: orderId,
      googleMapsApiKey: Deno.env.get("GOOGLE_MAPS_API_KEY") || ""
    });
    if (!result.anchor_order) return Response.json({ error: "Order not found" }, { status: 404 });
    return Response.json(result.anchor_snapshot || { on_route: false, activity_eligible: false });
  } catch (error) {
    console.error(`[getDeliveryEta] ${safeErrorMessage(error)}`);
    return Response.json({ error: "delivery_eta_unavailable" }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/getOrderBySession/entry.ts
import { createClientFromRequest as createClientFromRequest10 } from "npm:@base44/sdk@0.8.25";
import Stripe3 from "npm:stripe@14.21.0";
var stripe3 = new Stripe3(Deno.env.get("STRIPE_SECRET_KEY"));
async function requireAuthenticatedUser(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) {
    return { response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { user };
}
function authorizeOrderAccess2(user, order) {
  const requester = String(user?.email || "").trim().toLowerCase();
  const owner = String(order?.customer_email || "").trim().toLowerCase();
  if (user?.role === "admin" || requester === owner) {
    return null;
  }
  return Response.json({ error: "forbidden" }, { status: 403 });
}
function isPlausibleStripeSessionId(value) {
  return /^cs_(?:(?:test|live)_)?[A-Za-z0-9]{16,}$/.test(String(value || "").trim());
}
function isStripeMissingResource(error) {
  return error?.code === "resource_missing" || error?.statusCode === 404 || error?.status === 404;
}
async function handler10(req) {
  try {
    const base44 = createClientFromRequest10(req);
    const { session_id } = await req.json();
    if (!session_id) {
      return Response.json({ error: "session_id is required" }, { status: 400 });
    }
    if (!isPlausibleStripeSessionId(session_id)) {
      return Response.json({ error: "invalid session_id" }, { status: 400 });
    }
    const auth = await requireAuthenticatedUser(base44);
    if (auth.response) return auth.response;
    console.log(`[getOrderBySession] Looking up session: ${session_id}`);
    try {
      const ordersBySession = await base44.asServiceRole.entities.Order.filter({
        stripe_checkout_session_id: session_id
      });
      if (ordersBySession.length > 0) {
        console.log(`[getOrderBySession] Found order by stripe_checkout_session_id: ${ordersBySession[0].order_number}`);
        const forbidden = authorizeOrderAccess2(auth.user, ordersBySession[0]);
        if (forbidden) return forbidden;
        return Response.json({ order: ordersBySession[0], found: true });
      }
    } catch (e) {
      console.warn("[getOrderBySession] Error querying by stripe_checkout_session_id:", e.message);
    }
    let orderNumber = null;
    try {
      const checkoutSessions = await base44.asServiceRole.entities.CheckoutSession.filter({
        stripe_session_id: session_id
      });
      if (checkoutSessions.length > 0) {
        orderNumber = checkoutSessions[0].order_number;
        console.log(`[getOrderBySession] Found order_number from CheckoutSession: ${orderNumber}`);
      }
    } catch (e) {
      console.warn("[getOrderBySession] Error querying CheckoutSession:", e.message);
    }
    let stripeSession = null;
    try {
      stripeSession = await stripe3.checkout.sessions.retrieve(session_id);
      if (!orderNumber && stripeSession.metadata?.order_number) {
        orderNumber = stripeSession.metadata.order_number;
        console.log(`[getOrderBySession] Got order_number from Stripe metadata: ${orderNumber}`);
      }
    } catch (e) {
      if (isStripeMissingResource(e)) {
        console.warn("[getOrderBySession] Checkout session not found");
        return Response.json({
          found: false,
          session_status: null,
          payment_status: null,
          order_number: orderNumber || null
        });
      }
      console.error("[getOrderBySession] Stripe session lookup unavailable:", e.message);
      return Response.json({ error: "Unable to verify checkout session" }, { status: 502 });
    }
    const sessionStatus = stripeSession?.status;
    const paymentStatus = stripeSession?.payment_status;
    if (orderNumber) {
      try {
        const orders = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber });
        if (orders.length > 0) {
          console.log(`[getOrderBySession] Found order by order_number: ${orderNumber}`);
          const forbidden = authorizeOrderAccess2(auth.user, orders[0]);
          if (forbidden) return forbidden;
          return Response.json({
            order: orders[0],
            found: true,
            session_status: sessionStatus,
            payment_status: paymentStatus,
            order_number: orderNumber
          });
        }
      } catch (e) {
        console.warn("[getOrderBySession] Error querying by order_number:", e.message);
      }
    }
    console.log(`[getOrderBySession] Order not found yet. session_status=${sessionStatus}, payment_status=${paymentStatus}, order_number=${orderNumber}`);
    return Response.json({
      found: false,
      session_status: sessionStatus,
      payment_status: paymentStatus,
      order_number: orderNumber || null
    });
  } catch (error) {
    console.error("[getOrderBySession] Unexpected error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/pauseSubscription/entry.ts
import { createClientFromRequest as createClientFromRequest11 } from "npm:@base44/sdk@0.8.25";
import Stripe4 from "npm:stripe@14.21.0";
var stripe4 = new Stripe4(Deno.env.get("STRIPE_SECRET_KEY"));
async function handler11(req) {
  try {
    const base44 = createClientFromRequest11(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json();
    const { subscription_id, paused_until } = body;
    if (!subscription_id || !paused_until) {
      return Response.json({ error: "Missing subscription_id or paused_until" }, { status: 400 });
    }
    const subs = await base44.entities.Subscription.filter({ id: subscription_id });
    if (!subs || subs.length === 0 || subs[0].customer_email !== user.email) {
      return Response.json({ error: "Subscription not found" }, { status: 404 });
    }
    const sub = subs[0];
    const stripeSubId = sub.stripe_subscription_id;
    let periodEnd = null;
    if (stripeSubId) {
      try {
        const stripeSub = await stripe4.subscriptions.retrieve(stripeSubId);
        periodEnd = stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1e3).toISOString().split("T")[0] : null;
        await stripe4.subscriptions.update(stripeSubId, {
          pause_collection: {
            behavior: "void",
            resumes_at: Math.floor(new Date(paused_until).getTime() / 1e3)
          }
        });
        console.log(`[pauseSubscription] Stripe sub ${stripeSubId} pause_collection set. Effective after ${periodEnd}, resumes ${paused_until}`);
      } catch (stripeErr) {
        console.warn(`[pauseSubscription] Stripe pause_collection failed (non-blocking): ${stripeErr.message}`);
      }
    } else {
      console.warn(`[pauseSubscription] No stripe_subscription_id on sub ${subscription_id}`);
    }
    await base44.asServiceRole.entities.Subscription.update(subscription_id, {
      status: "paused",
      paused_until
    });
    console.log(`[pauseSubscription] CA Subscription ${subscription_id} set to paused until ${paused_until}`);
    return Response.json({
      success: true,
      paused_until,
      current_cycle_end: periodEnd,
      message: `Your current month remains fully active. Your subscription will pause after ${periodEnd ? new Date(periodEnd).toLocaleDateString() : "your current billing cycle"} and resume on ${new Date(paused_until).toLocaleDateString()}.`
    });
  } catch (error) {
    console.error("[pauseSubscription] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/registerPushSubscription/entry.ts
import { createClientFromRequest as createClientFromRequest12 } from "npm:@base44/sdk@0.8.25";
function normalizeEmail6(value) {
  return String(value || "").trim().toLowerCase();
}
function normalizeSingleLine2(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
function sanitizeUserAgent(value) {
  const text = normalizeSingleLine2(value);
  return text.length > 300 ? `${text.slice(0, 299).trim()}...` : text;
}
function sanitizeToken(value) {
  const text = normalizeSingleLine2(value);
  return text.length > 4096 ? "" : text;
}
function sanitizeApnsToken(value) {
  const text = normalizeSingleLine2(value).replace(/[^a-fA-F0-9]/g, "");
  return text.length >= 32 && text.length <= 512 ? text.toLowerCase() : "";
}
function resolveTokenType(body, fcmToken, apnsToken) {
  const requested = normalizeSingleLine2(body.token_type).toLowerCase();
  if (requested === "fcm" && fcmToken) return "fcm";
  if (requested === "apns" && apnsToken) return "apns";
  return fcmToken ? "fcm" : apnsToken ? "apns" : "web_push";
}
function isMissingSchemaError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("Entity schema") && message.includes("not found");
}
async function readJsonBody5(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}
var FALLBACK_MESSAGE_TYPE = "order_status";
function fallbackIdempotencyKey(customerEmail) {
  return `push_subscription_fallback:${customerEmail}`;
}
async function upsertFallbackPushSubscription(base44, payload) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const idempotencyKey = fallbackIdempotencyKey(payload.customer_email);
  const metadata = {
    purpose: "push_subscription_fallback",
    token_type: payload.token_type,
    endpoint: payload.endpoint || null,
    p256dh: payload.p256dh || null,
    auth: payload.auth || null,
    fcm_token: payload.fcm_token || null,
    apns_token: payload.apns_token || null,
    apns_environment: payload.apns_environment || null,
    app_bundle_id: payload.app_bundle_id || null,
    enabled: true,
    permission: payload.permission || "granted",
    device_platform: payload.device_platform || "",
    platform: payload.platform || "",
    app_shell: payload.app_shell || "",
    user_agent: payload.user_agent || "",
    last_seen_at: now,
    revoked_at: null
  };
  const fallbackPayload = {
    idempotency_key: idempotencyKey,
    channel: "push",
    message_type: FALLBACK_MESSAGE_TYPE,
    customer_email: payload.customer_email,
    provider: "internal",
    status: "sent",
    sent_at: now,
    metadata
  };
  const existing = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter(
    { idempotency_key: idempotencyKey },
    null,
    1
  );
  return existing[0] ? await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(existing[0].id, fallbackPayload) : await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(fallbackPayload);
}
async function handler12(req) {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  let requestBody = {};
  let requestBase44 = null;
  let requestUser = null;
  try {
    const base44 = createClientFromRequest12(req);
    requestBase44 = base44;
    const user = await base44.auth.me().catch(() => null);
    requestUser = user;
    if (!user?.email) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = await readJsonBody5(req);
    if (!body) {
      return Response.json({ error: "malformed_json" }, { status: 400 });
    }
    requestBody = body;
    const subscription = body.subscription || {};
    const fcmToken = sanitizeToken(body.fcm_token);
    const apnsToken = sanitizeApnsToken(body.apns_token);
    const tokenType = resolveTokenType(body, fcmToken, apnsToken);
    const endpoint = normalizeSingleLine2(subscription.endpoint);
    const p256dh = normalizeSingleLine2(subscription.keys?.p256dh);
    const auth = normalizeSingleLine2(subscription.keys?.auth);
    if (tokenType === "web_push" && (!endpoint || !p256dh || !auth)) {
      return Response.json({ error: "Invalid push subscription payload" }, { status: 400 });
    }
    const apnsEnvironment = body.apns_environment === "sandbox" || body.apns_environment === "production" ? body.apns_environment : "unknown";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const payload = {
      customer_email: normalizeEmail6(user.email),
      token_type: tokenType,
      endpoint: endpoint || null,
      p256dh: p256dh || null,
      auth: auth || null,
      fcm_token: fcmToken || null,
      apns_token: apnsToken || null,
      apns_environment: apnsToken ? apnsEnvironment : null,
      app_bundle_id: normalizeSingleLine2(body.app_bundle_id).slice(0, 160) || null,
      enabled: true,
      permission: body.permission === "denied" ? "denied" : body.permission === "default" ? "default" : "granted",
      device_platform: normalizeSingleLine2(body.device_platform).slice(0, 40),
      platform: normalizeSingleLine2(body.platform).slice(0, 120),
      app_shell: normalizeSingleLine2(body.app_shell).slice(0, 80),
      user_agent: sanitizeUserAgent(body.user_agent),
      last_seen_at: now,
      revoked_at: null
    };
    const existing = tokenType === "apns" ? await base44.asServiceRole.entities.PushSubscription.filter({ apns_token: apnsToken }, void 0, 1) : tokenType === "fcm" ? await base44.asServiceRole.entities.PushSubscription.filter({ fcm_token: fcmToken }, void 0, 1) : await base44.asServiceRole.entities.PushSubscription.filter({ endpoint }, void 0, 1);
    const record = existing[0] ? await base44.asServiceRole.entities.PushSubscription.update(existing[0].id, payload) : await base44.asServiceRole.entities.PushSubscription.create(payload);
    return Response.json({
      success: true,
      subscription_id: record.id,
      push_enabled: true,
      token_type: tokenType,
      device_platform: payload.device_platform || void 0
    });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      console.warn("[registerPushSubscription] PushSubscription schema unavailable");
      try {
        const base44 = requestBase44 || createClientFromRequest12(req);
        const user = requestUser || await base44.auth.me().catch(() => null);
        const body = requestBody || {};
        const subscription = body.subscription || {};
        const fcmToken = sanitizeToken(body.fcm_token);
        const apnsToken = sanitizeApnsToken(body.apns_token);
        const tokenType = resolveTokenType(body, fcmToken, apnsToken);
        const fallbackRecord = await upsertFallbackPushSubscription(base44, {
          customer_email: normalizeEmail6(user?.email),
          token_type: tokenType,
          endpoint: normalizeSingleLine2(subscription.endpoint) || null,
          p256dh: normalizeSingleLine2(subscription.keys?.p256dh) || null,
          auth: normalizeSingleLine2(subscription.keys?.auth) || null,
          fcm_token: fcmToken || null,
          apns_token: apnsToken || null,
          apns_environment: apnsToken && (body.apns_environment === "sandbox" || body.apns_environment === "production") ? body.apns_environment : apnsToken ? "unknown" : null,
          app_bundle_id: normalizeSingleLine2(body.app_bundle_id).slice(0, 160) || null,
          permission: body.permission === "denied" ? "denied" : body.permission === "default" ? "default" : "granted",
          device_platform: normalizeSingleLine2(body.device_platform).slice(0, 40),
          platform: normalizeSingleLine2(body.platform).slice(0, 120),
          app_shell: normalizeSingleLine2(body.app_shell).slice(0, 80),
          user_agent: sanitizeUserAgent(body.user_agent)
        });
        return Response.json({
          success: true,
          subscription_id: fallbackRecord.id,
          push_enabled: true,
          token_type: tokenType,
          storage: "CustomerMessageDeliveryLog"
        });
      } catch (fallbackError) {
        console.warn("[registerPushSubscription] Fallback push subscription storage unavailable");
        console.warn(fallbackError instanceof Error ? fallbackError.message : String(fallbackError || "unknown"));
      }
      return Response.json({
        success: false,
        push_enabled: false,
        reason: "push_subscription_fallback_storage_unavailable"
      });
    }
    console.error("[registerPushSubscription] Error");
    return Response.json({ error: "Unable to register push subscription" }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/requestAccountDeletion/entry.ts
import { createClientFromRequest as createClientFromRequest13 } from "npm:@base44/sdk@0.8.25";
var RETAINED_RECORD_CATEGORIES = [
  "orders",
  "payment_records",
  "refund_records",
  "tax_records",
  "subscription_history",
  "fulfillment_and_delivery_records",
  "food_safety_and_compliance_records",
  "sync_and_audit_logs"
];
function normalizeEmail7(value) {
  return String(value || "").trim().toLowerCase();
}
function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function sanitizeSource(value) {
  const source = String(value || "account_settings").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return source.slice(0, 80) || "account_settings";
}
function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  return message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]").slice(0, 500);
}
async function readJsonBody6(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}
async function resolveIdentityEmails(base44, userEmail) {
  const identities = /* @__PURE__ */ new Set([userEmail]);
  const userProfiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email: userEmail }, null, 10);
  const contactProfiles = await base44.asServiceRole.entities.UserProfile.filter({ contact_email: userEmail }, null, 10);
  for (const profile of [...userProfiles, ...contactProfiles]) {
    identities.add(normalizeEmail7(profile.customer_email));
    identities.add(normalizeEmail7(profile.contact_email));
  }
  return unique(Array.from(identities));
}
async function deleteRecordsForFilter(base44, entityName, filter) {
  const entityApi = base44.asServiceRole.entities[entityName];
  if (!entityApi?.filter || !entityApi?.delete) {
    throw new Error(`entity_api_unavailable:${entityName}`);
  }
  let deleted = 0;
  let page = await entityApi.filter(filter, null, 100);
  while (Array.isArray(page) && page.length > 0) {
    for (const record of page) {
      if (record?.id) {
        await entityApi.delete(record.id);
        deleted += 1;
      }
    }
    page = page.length === 100 ? await entityApi.filter(filter, null, 100) : [];
  }
  return deleted;
}
async function deleteAppOwnedRecords(base44, identityEmails) {
  const targets = [
    {
      entityName: "UserProfile",
      filters: identityEmails.flatMap((email3) => [
        { customer_email: email3 },
        { contact_email: email3 }
      ])
    },
    {
      entityName: "NotificationPreference",
      filters: identityEmails.map((email3) => ({ customer_email: email3 }))
    },
    {
      entityName: "PushSubscription",
      filters: identityEmails.map((email3) => ({ customer_email: email3 }))
    },
    {
      entityName: "Notification",
      filters: identityEmails.map((email3) => ({ customer_email: email3 }))
    },
    {
      entityName: "UserPoints",
      filters: identityEmails.map((email3) => ({ customer_email: email3 }))
    },
    {
      entityName: "LoyaltyTransaction",
      filters: identityEmails.map((email3) => ({ customer_email: email3 }))
    },
    {
      entityName: "LoyaltyMember",
      filters: identityEmails.map((email3) => ({ email: email3 }))
    }
  ];
  const deletedCounts = {};
  for (const target of targets) {
    let entityCount = 0;
    const seenFilters = /* @__PURE__ */ new Set();
    for (const filter of target.filters) {
      const key = JSON.stringify(filter);
      if (seenFilters.has(key)) continue;
      seenFilters.add(key);
      entityCount += await deleteRecordsForFilter(base44, target.entityName, filter);
    }
    deletedCounts[target.entityName] = entityCount;
  }
  return deletedCounts;
}
async function handler13(req) {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const base44 = createClientFromRequest13(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const body = await readJsonBody6(req);
  if (!body) {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }
  if (body.confirm !== "DELETE") {
    return Response.json({ error: "confirmation_required" }, { status: 400 });
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const requestorEmail = normalizeEmail7(user.email);
  let deletionRequest = null;
  try {
    const identityEmails = await resolveIdentityEmails(base44, requestorEmail);
    deletionRequest = await base44.asServiceRole.entities.AccountDeletionRequest.create({
      requestor_email: requestorEmail,
      identity_emails: identityEmails,
      requested_at: now,
      status: "processing",
      source: sanitizeSource(body.source),
      retained_record_categories: RETAINED_RECORD_CATEGORIES
    });
    const deletedCounts = await deleteAppOwnedRecords(base44, identityEmails);
    const completedAt = (/* @__PURE__ */ new Date()).toISOString();
    await base44.asServiceRole.entities.AccountDeletionRequest.update(deletionRequest.id, {
      status: "completed",
      completed_at: completedAt,
      deleted_counts: deletedCounts,
      retained_record_categories: RETAINED_RECORD_CATEGORIES
    });
    return Response.json({
      success: true,
      status: "completed",
      deletion_request_id: deletionRequest.id,
      completed_at: completedAt,
      deleted_counts: deletedCounts,
      retained_record_categories: RETAINED_RECORD_CATEGORIES
    });
  } catch (error) {
    const failureReason = sanitizeError(error);
    console.error("[requestAccountDeletion] Failed", failureReason);
    if (deletionRequest?.id) {
      await base44.asServiceRole.entities.AccountDeletionRequest.update(deletionRequest.id, {
        status: "failed",
        failure_reason: failureReason,
        retained_record_categories: RETAINED_RECORD_CATEGORIES
      }).catch(() => null);
    }
    return Response.json({
      success: false,
      error: "account_deletion_failed",
      retained_record_categories: RETAINED_RECORD_CATEGORIES
    }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/resolveShopifyCartPermalink/entry.ts
import { createClientFromRequest as createClientFromRequest14 } from "npm:@base44/sdk@0.8.25";
var PUBLIC_SHOPIFY_CATALOG_URL = "https://nuvira-juice-company.myshopify.com/products.json?limit=250";
var PUBLIC_SHOPIFY_CATALOG_CACHE_MS = 5 * 60 * 1e3;
var KNOWN_VARIANT_PRODUCTS = {
  // Current public Shopify/Meta variants. SKU values are Base44 Product ids.
  "43296833077338": { productId: "69e95a6b3b4d04fb9b9599d7", shopifyProductId: "7892143210586", title: "Reset Shot" },
  "43296833011802": { productId: "69e95a6b3b4d04fb9b9599d6", shopifyProductId: "7892143177818", title: "Hydration Shot" },
  "43296833044570": { productId: "69e95a6b3b4d04fb9b9599d5", shopifyProductId: "7892143145050", title: "Radiance Shot" },
  "43220774944858": { productId: "69d490ce699b5f1ac4dde497", shopifyProductId: "7868010987610", title: "OASIS" },
  "43220774846554": { productId: "69d490ce699b5f1ac4dde496", shopifyProductId: "7868010954842", title: "RE-NU" },
  "43220774813786": { productId: "69d490ce699b5f1ac4dde495", shopifyProductId: "7868010922074", title: "AURA" },
  "43222070198362": { productId: "69d490ce699b5f1ac4dde498", shopifyProductId: "7867922514010", title: "The NuVira Trio" },
  "43222071115866": { productId: "69d5b9df48ee4ce27d9eb8fc", shopifyProductId: "7867922153562", title: "Watermelon Juice" },
  "43222071181402": { productId: "69d5b9df48ee4ce27d9eb8fb", shopifyProductId: "7867922120794", title: "Pineapple Juice" },
  "43255063445594": { productId: "69d5b9df48ee4ce27d9eb8fa", shopifyProductId: "7867922088026", title: "Orange Juice" }
};
var publicShopifyCatalogCache = null;
function parseCartItems(raw) {
  return String(raw || "").split(",").slice(0, 20).map((entry) => {
    const [variantId, quantityRaw] = entry.split(":");
    const cleanVariantId = String(variantId || "").replace(/\D/g, "");
    const quantity = Math.max(1, Math.min(99, Number.parseInt(quantityRaw || "1", 10) || 1));
    return cleanVariantId ? { variantId: cleanVariantId, quantity } : null;
  }).filter(Boolean);
}
function normalizeLookup(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}
function slugify(value) {
  return normalizeLookup(value).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function shopifyNumericId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const gidMatch = text.match(/\/(\d+)$/);
  if (gidMatch) return gidMatch[1];
  return text.replace(/\D/g, "");
}
function productLookupKeys(product) {
  return [
    product.id,
    product.title,
    slugify(product.title),
    product.shopify_handle,
    product.handle,
    product.shopify_product_id,
    product.shopify_variant_id
  ].filter(Boolean).map(normalizeLookup);
}
function variantIdMatches(variant, requestedVariantId) {
  const candidates = [
    variant.shopify_variant_id,
    variant.variant_id,
    variant.id,
    variant.admin_graphql_api_id
  ];
  return candidates.some((value) => {
    const direct = String(value || "");
    return direct === requestedVariantId || shopifyNumericId(direct) === requestedVariantId;
  });
}
function getShopifyAdminConfig() {
  const SHOPIFY_API_TOKEN = Deno.env.get("SHOPIFY_API_TOKEN");
  const SHOPIFY_STORE_URL = Deno.env.get("SHOPIFY_STORE_URL");
  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) return null;
  return {
    token: SHOPIFY_API_TOKEN,
    storeHost: SHOPIFY_STORE_URL.replace(/^https?:\/\//, "")
  };
}
async function fetchShopifyVariant(variantId) {
  const config = getShopifyAdminConfig();
  if (!config) return null;
  const response = await fetch(`https://${config.storeHost}/admin/api/2024-01/variants/${variantId}.json`, {
    headers: {
      "X-Shopify-Access-Token": config.token,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    console.warn("Unable to resolve Shopify variant from Admin API:", variantId, response.status);
    return null;
  }
  const data = await response.json();
  if (!data?.variant) return null;
  return {
    productId: data.variant.product_id ? String(data.variant.product_id) : null,
    sku: data.variant.sku ? String(data.variant.sku) : "",
    title: data.variant.title ? String(data.variant.title) : ""
  };
}
async function fetchShopifyProduct(productId) {
  const config = getShopifyAdminConfig();
  const cleanProductId = shopifyNumericId(productId);
  if (!config || !cleanProductId) return null;
  const response = await fetch(`https://${config.storeHost}/admin/api/2024-01/products/${cleanProductId}.json`, {
    headers: {
      "X-Shopify-Access-Token": config.token,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    console.warn("Unable to resolve Shopify product from Admin API:", cleanProductId, response.status);
    return null;
  }
  const data = await response.json();
  if (!data?.product) return null;
  return {
    shopify_product_id: String(data.product.id),
    title: data.product.title,
    handle: data.product.handle,
    variants: (data.product.variants || []).map((variant) => ({
      shopify_variant_id: variant.id ? String(variant.id) : "",
      title: variant.title,
      sku: variant.sku || ""
    }))
  };
}
async function fetchPublicShopifyCatalog() {
  if (publicShopifyCatalogCache && publicShopifyCatalogCache.expiresAt > Date.now()) {
    return publicShopifyCatalogCache.products;
  }
  const response = await fetch(PUBLIC_SHOPIFY_CATALOG_URL, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    console.warn("Unable to resolve public Shopify catalog:", response.status);
    return [];
  }
  const data = await response.json();
  const products = (data?.products || []).map((product) => ({
    shopify_product_id: product.id ? String(product.id) : "",
    title: product.title,
    handle: product.handle,
    variants: (Array.isArray(product.variants) ? product.variants : []).map((variant) => ({
      shopify_variant_id: variant.id ? String(variant.id) : "",
      title: variant.title,
      sku: variant.sku || ""
    }))
  }));
  publicShopifyCatalogCache = {
    expiresAt: Date.now() + PUBLIC_SHOPIFY_CATALOG_CACHE_MS,
    products
  };
  return products;
}
function sanitizeProduct(product) {
  return {
    id: product.id,
    title: product.title,
    short_description: product.short_description,
    description: product.description,
    ingredients: product.ingredients,
    category: product.category,
    price: product.price,
    compare_at_price: product.compare_at_price,
    image_url: product.image_url,
    secondary_images: product.secondary_images,
    size: product.size,
    bottle_count: product.bottle_count,
    tags: product.tags,
    is_featured: product.is_featured,
    is_best_seller: product.is_best_seller,
    is_seasonal: product.is_seasonal,
    is_available: product.is_available,
    is_preorder: product.is_preorder,
    preorder_ship_date: product.preorder_ship_date,
    sort_order: product.sort_order,
    shopify_product_id: product.shopify_product_id,
    shopify_handle: product.shopify_handle,
    shopify_variant_id: product.shopify_variant_id
  };
}
async function handler14(req) {
  try {
    const base44 = createClientFromRequest14(req);
    const body = await req.json().catch(() => ({}));
    const requestedItems = parseCartItems(body.cart || body.items);
    if (requestedItems.length === 0) {
      return Response.json({ ok: false, error: "invalid_cart_permalink", items: [] }, { status: 400 });
    }
    const [shopifyProducts, products] = await Promise.all([
      base44.asServiceRole.entities.ShopifyProduct.list("-synced_at", 250),
      base44.asServiceRole.entities.Product.filter({ is_available: true }, "sort_order", 250)
    ]);
    const productByShopifyProductId = /* @__PURE__ */ new Map();
    const productByShopifyVariantId = /* @__PURE__ */ new Map();
    const productById = /* @__PURE__ */ new Map();
    const productByLookupKey = /* @__PURE__ */ new Map();
    const setProductByShopifyProductId = (shopifyProductId, product) => {
      const direct = String(shopifyProductId || "");
      const numeric = shopifyNumericId(shopifyProductId);
      if (direct) productByShopifyProductId.set(direct, product);
      if (numeric) productByShopifyProductId.set(numeric, product);
    };
    const getProductByShopifyProductId = (shopifyProductId) => productByShopifyProductId.get(String(shopifyProductId || "")) || productByShopifyProductId.get(shopifyNumericId(shopifyProductId));
    for (const product of products) {
      if (product.id) {
        productById.set(String(product.id), product);
      }
      if (product.shopify_product_id) {
        setProductByShopifyProductId(product.shopify_product_id, product);
      }
      if (product.shopify_variant_id) {
        productByShopifyVariantId.set(String(product.shopify_variant_id), product);
      }
      for (const key of productLookupKeys(product)) {
        if (!productByLookupKey.has(key)) {
          productByLookupKey.set(key, product);
        }
      }
    }
    const findProductByLookup = (...values) => {
      for (const value of values) {
        const normalized = normalizeLookup(value);
        if (normalized && productByLookupKey.has(normalized)) return productByLookupKey.get(normalized);
        const slug = slugify(value);
        if (slug && productByLookupKey.has(slug)) return productByLookupKey.get(slug);
      }
      return null;
    };
    const findProductForShopifyProduct = (shopifyProduct, variant) => {
      if (!shopifyProduct) return null;
      const base44ProductId = shopifyProduct.base44_product_id ? String(shopifyProduct.base44_product_id) : "";
      if (base44ProductId && productById.has(base44ProductId)) return productById.get(base44ProductId);
      const variantSku = variant?.sku ? String(variant.sku) : "";
      if (variantSku && productById.has(variantSku)) return productById.get(variantSku);
      const shopifyProductId = shopifyProduct.shopify_product_id ? String(shopifyProduct.shopify_product_id) : "";
      const productByShopifyId = getProductByShopifyProductId(shopifyProductId);
      if (productByShopifyId) return productByShopifyId;
      return findProductByLookup(variantSku, shopifyProduct.handle, shopifyProduct.title);
    };
    const getKnownVariantProduct = (variantId) => {
      const knownVariant = KNOWN_VARIANT_PRODUCTS[variantId];
      if (!knownVariant) return { product: null, shopifyProductId: null };
      const product = productById.get(knownVariant.productId) || getProductByShopifyProductId(knownVariant.shopifyProductId) || findProductByLookup(knownVariant.title);
      return {
        product,
        shopifyProductId: knownVariant.shopifyProductId
      };
    };
    let publicShopifyProductsForRequest = null;
    const findPublicShopifyProductForVariant = async (variantId) => {
      if (!publicShopifyProductsForRequest) {
        publicShopifyProductsForRequest = await fetchPublicShopifyCatalog();
      }
      let matchedVariant = null;
      const shopifyProduct = publicShopifyProductsForRequest.find((candidate) => {
        matchedVariant = (candidate.variants || []).find(
          (variant) => variantIdMatches(variant, variantId)
        ) || null;
        return Boolean(matchedVariant);
      });
      return { shopifyProduct, matchedVariant };
    };
    const resolvedItems = [];
    const unresolvedItems = [];
    for (const item of requestedItems) {
      let product = productByShopifyVariantId.get(item.variantId);
      let shopifyProductId = product?.shopify_product_id ? String(product.shopify_product_id) : null;
      if (!product) {
        const knownVariant = getKnownVariantProduct(item.variantId);
        product = knownVariant.product;
        shopifyProductId = knownVariant.shopifyProductId;
      }
      if (!product) {
        let matchedVariant = null;
        const shopifyProduct = shopifyProducts.find((candidate) => {
          matchedVariant = (candidate.variants || []).find(
            (variant) => variantIdMatches(variant, item.variantId)
          ) || null;
          return Boolean(matchedVariant);
        });
        shopifyProductId = shopifyProduct?.shopify_product_id ? String(shopifyProduct.shopify_product_id) : null;
        product = findProductForShopifyProduct(shopifyProduct, matchedVariant);
      }
      if (!product) {
        const { shopifyProduct, matchedVariant } = await findPublicShopifyProductForVariant(item.variantId);
        shopifyProductId = shopifyProduct?.shopify_product_id ? String(shopifyProduct.shopify_product_id) : null;
        product = findProductForShopifyProduct(shopifyProduct, matchedVariant);
      }
      if (!product) {
        const shopifyVariant = await fetchShopifyVariant(item.variantId);
        shopifyProductId = shopifyVariant?.productId || null;
        product = getProductByShopifyProductId(shopifyProductId);
        if (!product && shopifyVariant?.sku) {
          product = productById.get(shopifyVariant.sku) || findProductByLookup(shopifyVariant.sku);
        }
        if (!product && shopifyProductId) {
          const shopifyProduct = await fetchShopifyProduct(shopifyProductId);
          const matchingVariant = shopifyProduct?.variants?.find(
            (variant) => variantIdMatches(variant, item.variantId)
          ) || null;
          product = findProductForShopifyProduct(shopifyProduct, matchingVariant || shopifyVariant);
        }
      }
      if (!product) {
        unresolvedItems.push({ variant_id: item.variantId, quantity: item.quantity });
        continue;
      }
      resolvedItems.push({
        quantity: item.quantity,
        shopify_variant_id: item.variantId,
        shopify_product_id: shopifyProductId || product.shopify_product_id || null,
        product: sanitizeProduct(product)
      });
    }
    return Response.json({
      ok: resolvedItems.length > 0,
      items: resolvedItems,
      unresolved_items: unresolvedItems
    });
  } catch (error) {
    console.error("resolveShopifyCartPermalink error:", error);
    return Response.json({ ok: false, error: "resolver_failed", items: [] }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/stripeCustomerPortal/entry.ts
import { createClientFromRequest as createClientFromRequest15 } from "npm:@base44/sdk@0.8.25";
import Stripe5 from "npm:stripe@14.21.0";
var stripe5 = new Stripe5(Deno.env.get("STRIPE_SECRET_KEY"));
async function handler15(req) {
  try {
    const base44 = createClientFromRequest15(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const origin = req.headers.get("origin") || "https://app.base44.com";
    const customers = await stripe5.customers.list({ email: user.email, limit: 1 });
    if (!customers.data.length) {
      return Response.json({ error: "No Stripe customer found for this account." }, { status: 404 });
    }
    const customerId = customers.data[0].id;
    const portalSession = await stripe5.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account/subscriptions`
    });
    return Response.json({ url: portalSession.url });
  } catch (error) {
    console.error("Stripe customer portal error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/syncUserToHub/entry.ts
import { createClientFromRequest as createClientFromRequest16 } from "npm:@base44/sdk@0.8.25";
function normalizeEmail8(value) {
  return String(value || "").trim().toLowerCase();
}
async function handler16(req) {
  try {
    const base44 = createClientFromRequest16(req);
    const body = await req.json();
    const { email: email3 } = body;
    if (!email3) {
      return Response.json({ error: "Missing email" }, { status: 400 });
    }
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin" && normalizeEmail8(user.email) !== normalizeEmail8(email3)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    return Response.json({
      success: true,
      skipped: true,
      retired: true,
      source: "customer_app_profile_authoritative",
      external_calls_performed: false
    });
  } catch (error) {
    console.error("syncUserToHub error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/unregisterPushSubscription/entry.ts
import { createClientFromRequest as createClientFromRequest17 } from "npm:@base44/sdk@0.8.25";
function normalizeEmail9(value) {
  return String(value || "").trim().toLowerCase();
}
function normalizeSingleLine3(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
function normalizeApnsToken(value) {
  return normalizeSingleLine3(value).replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}
function isMissingSchemaError2(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("Entity schema") && message.includes("not found");
}
async function readJsonBody7(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}
function isFallbackSubscriptionLog(record) {
  return record.channel === "push" && (record.message_type === "push_subscription_fallback" || record.metadata?.purpose === "push_subscription_fallback");
}
function fallbackMatchesSelector(metadata, selectors) {
  if (selectors.apnsToken) {
    return normalizeApnsToken(metadata.apns_token) === selectors.apnsToken;
  }
  if (selectors.fcmToken) {
    return normalizeSingleLine3(metadata.fcm_token) === selectors.fcmToken;
  }
  if (selectors.endpoint) {
    return normalizeSingleLine3(metadata.endpoint) === selectors.endpoint;
  }
  return true;
}
async function revokeFallbackPushSubscriptions(base44, customerEmail, selectors) {
  const rows = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({ customer_email: customerEmail });
  let revoked = 0;
  const revokedAt = (/* @__PURE__ */ new Date()).toISOString();
  for (const row of rows) {
    if (!isFallbackSubscriptionLog(row)) continue;
    const metadata = row.metadata || {};
    if (metadata.enabled === false || metadata.revoked_at) continue;
    if (!fallbackMatchesSelector(metadata, selectors)) continue;
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(row.id, {
      status: "skipped",
      metadata: {
        ...metadata,
        enabled: false,
        permission: "default",
        revoked_at: revokedAt
      }
    });
    revoked += 1;
  }
  return revoked;
}
async function handler17(req) {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  let requestBase44 = null;
  let customerEmail = "";
  let endpoint = "";
  let fcmToken = "";
  let apnsToken = "";
  try {
    const base44 = createClientFromRequest17(req);
    requestBase44 = base44;
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = await readJsonBody7(req);
    if (!body) {
      return Response.json({ error: "malformed_json" }, { status: 400 });
    }
    endpoint = normalizeSingleLine3(body.endpoint);
    fcmToken = normalizeSingleLine3(body.fcm_token);
    apnsToken = normalizeApnsToken(body.apns_token);
    customerEmail = normalizeEmail9(user.email);
    const candidates = apnsToken ? await base44.asServiceRole.entities.PushSubscription.filter({ apns_token: apnsToken }) : fcmToken ? await base44.asServiceRole.entities.PushSubscription.filter({ fcm_token: fcmToken }) : endpoint ? await base44.asServiceRole.entities.PushSubscription.filter({ endpoint }) : await base44.asServiceRole.entities.PushSubscription.filter({ customer_email: customerEmail });
    let revoked = 0;
    const revokedAt = (/* @__PURE__ */ new Date()).toISOString();
    for (const record of candidates) {
      if (normalizeEmail9(record.customer_email) !== customerEmail) continue;
      await base44.asServiceRole.entities.PushSubscription.update(record.id, {
        enabled: false,
        permission: "default",
        revoked_at: revokedAt
      });
      revoked += 1;
    }
    return Response.json({ success: true, revoked });
  } catch (error) {
    if (isMissingSchemaError2(error)) {
      console.warn("[unregisterPushSubscription] PushSubscription schema unavailable");
      try {
        const revoked = await revokeFallbackPushSubscriptions(requestBase44, customerEmail, { endpoint, fcmToken, apnsToken });
        return Response.json({
          success: true,
          revoked,
          storage: "CustomerMessageDeliveryLog"
        });
      } catch (fallbackError) {
        console.warn("[unregisterPushSubscription] Fallback push subscription storage unavailable");
        console.warn(fallbackError instanceof Error ? fallbackError.message : String(fallbackError || "unknown"));
      }
      return Response.json({
        success: true,
        revoked: 0,
        reason: "push_subscription_fallback_storage_unavailable"
      });
    }
    console.error("[unregisterPushSubscription] Error");
    return Response.json({ error: "Unable to unregister push subscription" }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/validateDeliveryEligibility/entry.ts
import { createClientFromRequest as createClientFromRequest18 } from "npm:@base44/sdk@0.8.25";
var ORIGIN_ADDRESS2 = "619 N Main St, O'Fallon, MO 63366";
async function readJsonBody8(req) {
  try {
    const raw = await req.text();
    if (!raw || raw.trim() === "") return { ok: true, body: {} };
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: Response.json({ error: "malformed_json" }, { status: 400 }) };
  }
}
var ZONES = [
  // ── Zone 1A: 0–5 miles — $3.99 ─────────────────────────────────────────────
  {
    zone_key: "zone_1a_core_0_5",
    zone_name: "Core Delivery",
    zone_tier_label: "Core Delivery",
    zone_type: "core",
    min: 0,
    max: 5,
    delivery_fee: 3.99,
    minimum_order: null,
    approval_required: false,
    manual_capture_required: false,
    checkout_allowed: true,
    payment_capture_method: "automatic",
    allowed_for_subscriptions: true
  },
  // ── Zone 1B: 5.01–10 miles — $5.99 ─────────────────────────────────────────
  {
    zone_key: "zone_1b_core_5_10",
    zone_name: "Core Delivery",
    zone_tier_label: "Core Delivery",
    zone_type: "core",
    min: 5.01,
    max: 10,
    delivery_fee: 5.99,
    minimum_order: null,
    approval_required: false,
    manual_capture_required: false,
    checkout_allowed: true,
    payment_capture_method: "automatic",
    allowed_for_subscriptions: true
  },
  // ── Zone 1C: 10.01–15 miles — $7.99 ─────────────────────────────────────────
  {
    zone_key: "zone_1c_core_10_15",
    zone_name: "Core Delivery",
    zone_tier_label: "Core Delivery",
    zone_type: "core",
    min: 10.01,
    max: 15,
    delivery_fee: 7.99,
    minimum_order: null,
    approval_required: false,
    manual_capture_required: false,
    checkout_allowed: true,
    payment_capture_method: "automatic",
    allowed_for_subscriptions: true
  },
  // ── Zone 2: 15.01–25 miles — $9.99, $49.99 minimum ─────────────────────────
  {
    zone_key: "zone_2_extended",
    zone_name: "Extended Delivery",
    zone_tier_label: "Extended Delivery",
    zone_type: "extended",
    min: 15.01,
    max: 25,
    delivery_fee: 9.99,
    minimum_order: 49.99,
    approval_required: false,
    manual_capture_required: false,
    checkout_allowed: true,
    payment_capture_method: "automatic",
    allowed_for_subscriptions: true
  },
  // ── Zone 3A: 25.01–30 miles — $12.99, route review ─────────────────────────
  {
    zone_key: "zone_3a_route_review_25_30",
    zone_name: "Route Review Zone",
    zone_tier_label: "Route Review Required",
    zone_type: "route_review",
    min: 25.01,
    max: 30,
    delivery_fee: 12.99,
    minimum_order: 59.99,
    approval_required: true,
    manual_capture_required: true,
    checkout_allowed: true,
    payment_capture_method: "manual",
    allowed_for_subscriptions: false
  },
  // ── Zone 3B: 30.01–35 miles — $15.99, route review ─────────────────────────
  {
    zone_key: "zone_3b_route_review_30_35",
    zone_name: "Extended Route Review Zone",
    zone_tier_label: "Route Review Required",
    zone_type: "route_review",
    min: 30.01,
    max: 35,
    delivery_fee: 15.99,
    minimum_order: 72,
    approval_required: true,
    manual_capture_required: true,
    checkout_allowed: true,
    payment_capture_method: "manual",
    allowed_for_subscriptions: false
  },
  // ── Waitlist: 35+ miles ──────────────────────────────────────────────────────
  {
    zone_key: "waitlist_only",
    zone_name: "Delivery Waitlist Area",
    zone_tier_label: "Not Yet Available",
    zone_type: "waitlist_only",
    min: 35.01,
    max: 99999,
    delivery_fee: null,
    minimum_order: null,
    approval_required: true,
    manual_capture_required: false,
    checkout_allowed: false,
    payment_capture_method: null,
    allowed_for_subscriptions: false
  }
];
function classifyByMiles(miles) {
  for (const zone of ZONES) {
    if (miles >= zone.min && miles <= zone.max) return zone;
  }
  return ZONES[ZONES.length - 1];
}
function buildCustomerMessage(zone, cartSubtotal, orderType) {
  if (zone.zone_type === "core") {
    return "Great news \u2014 your address is in our NuVira delivery zone.";
  }
  if (zone.zone_type === "extended") {
    const minMet = !zone.minimum_order || cartSubtotal >= zone.minimum_order;
    if (minMet) {
      return `Your address is in our extended delivery zone. Extended delivery includes a $${zone.delivery_fee.toFixed(2)} delivery fee.`;
    }
    const needed = (zone.minimum_order - cartSubtotal).toFixed(2);
    return `Your address is in our extended delivery zone. Extended delivery requires a $${zone.minimum_order.toFixed(2)} minimum order. Add $${needed} more to continue.`;
  }
  if (zone.zone_type === "route_review") {
    if (orderType === "subscription") {
      return "Your address requires route review before we can activate a subscription. Submit your request and our team will review delivery availability.";
    }
    return "Your address is outside our automatic delivery routes, but we may still be able to deliver depending on route availability. We'll place a temporary authorization hold on your card, but you will not be charged unless your request is approved.";
  }
  if (zone.zone_type === "waitlist_only") {
    return "We're not delivering to this address just yet. Join the delivery waitlist and we'll notify you when your area opens.";
  }
  return "We're unable to deliver to this address at this time.";
}
async function handler18(req) {
  try {
    const base44 = createClientFromRequest18(req);
    const parsed = await readJsonBody8(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body || {};
    const {
      delivery_address,
      address_line1,
      address_city,
      address_state,
      address_postal_code,
      cart_subtotal = 0,
      cart_items = [],
      customer_email,
      customer_phone,
      order_type = "one_time",
      _test_distance_miles
      // Admin-only mock: bypasses Google Maps for unit testing
    } = body;
    const normalizedAddress = delivery_address || [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(", ");
    if (!normalizedAddress || normalizedAddress.trim().length < 5) {
      return Response.json({
        eligible: false,
        checkout_allowed: false,
        automatic_checkout_allowed: false,
        approval_required: false,
        manual_capture_required: false,
        zone_key: null,
        zone_name: null,
        zone_type: null,
        delivery_fee: null,
        minimum_order: null,
        minimum_order_met: false,
        amount_needed: 0,
        estimated_distance_miles: null,
        estimated_drive_time_minutes: null,
        distance_confidence: null,
        suggested_delivery_fee: null,
        payment_capture_method: null,
        customer_message: "Please enter a valid delivery address.",
        admin_message: "Address string too short or missing.",
        reason_code: "INVALID_ADDRESS"
      }, { status: 200 });
    }
    let distanceMiles = null;
    let driveTimeMinutes = null;
    let distanceConfidence = "estimated";
    let resolvedAddress = normalizedAddress;
    if (typeof _test_distance_miles === "number") {
      const user = await base44.auth.me();
      if (user?.role === "admin") {
        distanceMiles = _test_distance_miles;
        driveTimeMinutes = Math.round(_test_distance_miles * 1.5);
        distanceConfidence = "mocked_test";
        console.log(`[validateDeliveryEligibility] MOCK distance: ${distanceMiles} miles (admin test)`);
      }
    }
    const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (apiKey && distanceMiles === null) {
      try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS2)}&destinations=${encodeURIComponent(normalizedAddress)}&units=imperial&key=${apiKey}`;
        const res = await fetch(url);
        const data = await res.json();
        console.log(`[validateDeliveryEligibility] Maps API status: ${data.status}`);
        if (data.status === "OK") {
          const element = data.rows?.[0]?.elements?.[0];
          if (element?.status === "OK") {
            distanceMiles = Math.round(element.distance.value / 1609.344 * 10) / 10;
            driveTimeMinutes = Math.round(element.duration.value / 60);
            distanceConfidence = "driving";
            resolvedAddress = data.destination_addresses?.[0] || normalizedAddress;
            console.log(`[validateDeliveryEligibility] Distance: ${distanceMiles} miles, ${driveTimeMinutes} min drive`);
          } else {
            console.warn(`[validateDeliveryEligibility] Element status: ${element?.status}`);
          }
        } else {
          console.warn(`[validateDeliveryEligibility] Maps API returned status: ${data.status}`);
        }
      } catch (mapsErr) {
        console.error(`[validateDeliveryEligibility] Maps API error: ${mapsErr.message}`);
      }
    }
    if (distanceMiles === null) {
      console.warn("[validateDeliveryEligibility] Could not determine driving distance \u2014 returning address_lookup_failed");
      return Response.json({
        eligible: false,
        checkout_allowed: false,
        automatic_checkout_allowed: false,
        approval_required: false,
        manual_capture_required: false,
        zone_key: null,
        zone_name: null,
        zone_type: null,
        delivery_fee: null,
        minimum_order: null,
        minimum_order_met: false,
        amount_needed: 0,
        estimated_distance_miles: null,
        estimated_drive_time_minutes: null,
        distance_confidence: "unknown",
        suggested_delivery_fee: null,
        payment_capture_method: null,
        customer_message: "Could not look up this address. Please check and try again.",
        admin_message: "Google Maps Distance Matrix API returned no result.",
        reason_code: "ADDRESS_LOOKUP_FAILED"
      }, { status: 200 });
    }
    const zone = classifyByMiles(distanceMiles);
    const minimumOrder = zone.minimum_order;
    const minimumOrderMet = minimumOrder === null || cart_subtotal >= minimumOrder;
    const amountNeeded = minimumOrderMet ? 0 : Math.round((minimumOrder - cart_subtotal) * 100) / 100;
    const subscriptionRouteReviewRequired = zone.zone_type === "route_review" && order_type === "subscription";
    const subscriptionBlocked = !zone.allowed_for_subscriptions && order_type === "subscription";
    let checkoutAllowed = zone.checkout_allowed;
    let reasonCode = "ELIGIBLE";
    if (!checkoutAllowed) {
      reasonCode = zone.zone_type === "waitlist_only" ? "WAITLIST_ONLY" : "ZONE_BLOCKED";
    } else if (!minimumOrderMet) {
      checkoutAllowed = false;
      reasonCode = "MINIMUM_ORDER_NOT_MET";
    } else if (subscriptionBlocked) {
      checkoutAllowed = false;
      reasonCode = "SUBSCRIPTION_NOT_AVAILABLE_IN_ZONE";
    } else if (zone.zone_type === "route_review") {
      reasonCode = "ROUTE_REVIEW_REQUIRED";
    } else {
      reasonCode = "ELIGIBLE";
    }
    const automaticCheckoutAllowed = checkoutAllowed && !zone.approval_required;
    const customerMessage = buildCustomerMessage(zone, cart_subtotal, order_type);
    const adminMessage = [
      `Zone: ${zone.zone_key} (${zone.zone_name})`,
      `Distance: ${distanceMiles} miles driving (${distanceConfidence})`,
      `Drive time: ${driveTimeMinutes ?? "N/A"} min`,
      `Cart: $${cart_subtotal.toFixed(2)}`,
      `Minimum: ${minimumOrder ? "$" + minimumOrder.toFixed(2) : "none"}`,
      `Minimum met: ${minimumOrderMet}`,
      `Order type: ${order_type}`,
      `Reason: ${reasonCode}`
    ].join(" | ");
    console.log(`[validateDeliveryEligibility] ${adminMessage}`);
    return Response.json({
      eligible: checkoutAllowed,
      checkout_allowed: checkoutAllowed,
      automatic_checkout_allowed: automaticCheckoutAllowed,
      approval_required: zone.approval_required,
      manual_capture_required: zone.manual_capture_required,
      zone_key: zone.zone_key,
      zone_name: zone.zone_name,
      zone_tier_label: zone.zone_tier_label,
      zone_type: zone.zone_type,
      delivery_fee: zone.delivery_fee,
      minimum_order: minimumOrder,
      minimum_order_met: minimumOrderMet,
      amount_needed: amountNeeded,
      estimated_distance_miles: distanceMiles,
      estimated_drive_time_minutes: driveTimeMinutes,
      distance_confidence: distanceConfidence,
      suggested_delivery_fee: zone.delivery_fee,
      payment_capture_method: zone.payment_capture_method,
      subscription_route_review_required: subscriptionRouteReviewRequired,
      allowed_for_subscriptions: zone.allowed_for_subscriptions,
      customer_message: customerMessage,
      admin_message: adminMessage,
      reason_code: reasonCode,
      resolved_address: resolvedAddress
    }, { status: 200 });
  } catch (error) {
    console.error("[validateDeliveryEligibility] Error:", error.message);
    return Response.json({
      eligible: false,
      checkout_allowed: false,
      automatic_checkout_allowed: false,
      approval_required: false,
      manual_capture_required: false,
      zone_key: null,
      zone_name: null,
      zone_type: null,
      delivery_fee: null,
      minimum_order: null,
      minimum_order_met: false,
      amount_needed: 0,
      estimated_distance_miles: null,
      estimated_drive_time_minutes: null,
      distance_confidence: "unknown",
      suggested_delivery_fee: null,
      payment_capture_method: null,
      customer_message: "An error occurred checking your delivery address. Please try again.",
      admin_message: error.message,
      reason_code: "INTERNAL_ERROR"
    }, { status: 200 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/createZone3SubscriptionReviewRequest/entry.ts
import { createClientFromRequest as createClientFromRequest19 } from "npm:@base44/sdk@0.8.25";
import Stripe6 from "npm:stripe@14.21.0";
var stripe6 = new Stripe6(Deno.env.get("STRIPE_SECRET_KEY"));
async function authorizeCheckoutCustomer2(base44, customerEmail) {
  const user = await base44.auth.me().catch(() => null);
  const requested = String(customerEmail || "").trim().toLowerCase();
  const requester = String(user?.email || "").trim().toLowerCase();
  if (!user?.email || !requested) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role === "admin" || requester === requested) return null;
  return Response.json({ error: "forbidden" }, { status: 403 });
}
var ORIGIN_ADDRESS3 = "619 N Main St, O'Fallon, MO 63366";
var ZONE_RULES2 = [
  { zone_key: "zone_1_core", zone_type: "core", min: 0, max: 15, delivery_fee: 5.99 },
  { zone_key: "zone_2_extended", zone_type: "extended", min: 15.01, max: 25, delivery_fee: 9.99 },
  { zone_key: "zone_3_route_review", zone_type: "route_review", min: 25.01, max: 30, delivery_fee: 12.99 },
  { zone_key: "zone_3_route_review", zone_type: "route_review", min: 30.01, max: 35, delivery_fee: 15.99 },
  { zone_key: "waitlist_only", zone_type: "waitlist_only", min: 35.01, max: 99999, delivery_fee: null }
];
async function getDistanceAndZone(address) {
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured");
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS3)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`Maps API status: ${data.status}`);
  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== "OK") throw new Error(`Maps element: ${element?.status}`);
  const distanceMiles = Math.round(element.distance.value / 1609.344 * 10) / 10;
  const driveTimeMinutes = Math.round(element.duration.value / 60);
  const zone = ZONE_RULES2.find((z) => distanceMiles >= z.min && distanceMiles <= z.max) || ZONE_RULES2[ZONE_RULES2.length - 1];
  return { distanceMiles, driveTimeMinutes, zone };
}
function generateRequestNumber() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "SUBR-";
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}
async function handler19(req) {
  try {
    if (Deno.env.get("ENABLE_SUBSCRIPTION_CHECKOUTS") !== "true") {
      return Response.json({
        success: false,
        skipped: true,
        gate: "ENABLE_SUBSCRIPTION_CHECKOUTS",
        reason: "subscription_checkouts_disabled",
        message: "Subscription checkout is currently unavailable. One-time orders are still available."
      }, { status: 409 });
    }
    const base44 = createClientFromRequest19(req);
    const {
      plan_id,
      customer_email,
      customer_name,
      customer_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      delivery_address,
      save_payment_method
      // optional: true = create SetupIntent
    } = await req.json();
    const unauthorized = await authorizeCheckoutCustomer2(base44, customer_email);
    if (unauthorized) return unauthorized;
    if (!plan_id || !customer_email || !delivery_address) {
      return Response.json({ error: "Missing required fields: plan_id, customer_email, delivery_address" }, { status: 400 });
    }
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (!plans[0]) return Response.json({ error: "Plan not found" }, { status: 404 });
    const plan = plans[0];
    let resolvedName = customer_name || "";
    let resolvedPhone = customer_phone || "";
    try {
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
      if (profiles[0]) {
        const p = profiles[0];
        resolvedName = resolvedName || [p.first_name, p.last_name].filter(Boolean).join(" ");
        resolvedPhone = resolvedPhone || p.phone || "";
      }
    } catch (err) {
      console.warn(`[Zone3SubReview] Profile fetch failed: ${err.message}`);
    }
    let distanceMiles, driveTimeMinutes, zone;
    try {
      ({ distanceMiles, driveTimeMinutes, zone } = await getDistanceAndZone(delivery_address));
    } catch (err) {
      return Response.json({ error: `Could not verify delivery address: ${err.message}` }, { status: 400 });
    }
    if (zone.zone_type !== "route_review") {
      return Response.json({
        error: "Address is not in a Zone 3 route review area.",
        zone_type: zone.zone_type,
        zone_key: zone.zone_key
      }, { status: 400 });
    }
    const existingDARs = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({
      customer_email
    });
    const activeDARForPlan = existingDARs.find(
      (d) => d.request_type === "subscription_route_review" && d.selected_plan_id === plan_id && ["draft", "pending_authorization", "pending_review"].includes(d.status)
    );
    if (activeDARForPlan) {
      console.log(`[Zone3SubReview] Existing active DAR ${activeDARForPlan.id} found for ${customer_email}, returning it`);
      return Response.json({
        success: true,
        dar_id: activeDARForPlan.id,
        request_number: activeDARForPlan.request_number,
        status: activeDARForPlan.status,
        setup_intent_client_secret: activeDARForPlan.stripe_setup_intent_client_secret || null,
        already_exists: true
      });
    }
    const requestNumber = generateRequestNumber();
    const dar = await base44.asServiceRole.entities.DeliveryApprovalRequest.create({
      request_number: requestNumber,
      request_type: "subscription_route_review",
      customer_name: resolvedName,
      customer_email,
      customer_phone: resolvedPhone,
      delivery_address,
      address_line1: address_line1 || "",
      address_line2: address_line2 || "",
      address_city: address_city || "",
      address_state: address_state || "",
      address_postal_code: address_postal_code || "",
      address_country: "US",
      selected_plan_id: plan_id,
      selected_plan_name: plan.name,
      selected_plan_price: plan.base_price,
      selected_plan_frequency: plan.frequency,
      cart_subtotal: plan.base_price,
      estimated_delivery_fee: zone.delivery_fee,
      estimated_total: plan.base_price + (zone.delivery_fee || 0),
      estimated_distance_miles: distanceMiles,
      estimated_drive_time_minutes: driveTimeMinutes,
      zone_key: zone.zone_key,
      zone_name: zone.zone_key,
      zone_type: zone.zone_type,
      status: "pending_review",
      customer_acknowledged_hold: false,
      audit_trail: [{
        action: "subscription_route_review_requested",
        performed_by: customer_email,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        note: `Zone 3 subscription route review submitted for plan "${plan.name}" ($${plan.base_price}/${plan.frequency}). Distance: ${distanceMiles} mi.`
      }]
    });
    console.log(`[Zone3SubReview] Created DAR ${dar.id} (${requestNumber}) for ${customer_email}, plan ${plan.name}`);
    let setupIntentClientSecret = null;
    if (save_payment_method) {
      try {
        const customers = await stripe6.customers.list({ email: customer_email, limit: 1 });
        const stripeCustomer = customers.data[0] || await stripe6.customers.create({
          email: customer_email,
          name: resolvedName,
          phone: resolvedPhone || void 0,
          metadata: { source_app: "customer_app" }
        });
        const setupIntent = await stripe6.setupIntents.create({
          customer: stripeCustomer.id,
          payment_method_types: ["card"],
          usage: "off_session",
          metadata: {
            base44_app_id: Deno.env.get("BASE44_APP_ID"),
            flow_type: "zone3_subscription_route_review",
            dar_id: dar.id,
            customer_email,
            plan_id,
            plan_name: plan.name
          }
        });
        setupIntentClientSecret = setupIntent.client_secret;
        await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar.id, {
          stripe_setup_intent_id: setupIntent.id,
          stripe_setup_intent_client_secret: setupIntentClientSecret,
          stripe_customer_id: stripeCustomer.id,
          audit_trail: [...dar.audit_trail || [], {
            action: "setup_intent_created",
            performed_by: "system",
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            note: `SetupIntent ${setupIntent.id} created for card save.`
          }]
        });
        console.log(`[Zone3SubReview] SetupIntent ${setupIntent.id} created for ${customer_email}`);
      } catch (siErr) {
        console.warn(`[Zone3SubReview] SetupIntent creation failed (non-blocking): ${siErr.message}`);
      }
    }
    base44.asServiceRole.functions.invoke("sendCustomerNotification", {
      customer_email,
      type: "general",
      title: "Subscription Route Review Submitted \u2705",
      message: `Your request to subscribe with delivery to ${delivery_address} has been submitted. We'll review your route and notify you within 24\u201348 hours. Request #${requestNumber}.`,
      deep_link: "/account/subscriptions",
      idempotency_key: `zone3_sub_review_submitted_${dar.id}`
    }).catch(() => {
    });
    base44.asServiceRole.functions.invoke("sendCustomerNotification", {
      customer_email: "info@nuvirajuice.com",
      type: "general",
      title: "\u{1F5FA}\uFE0F Zone 3 Subscription Route Review",
      message: `New subscription route review from ${resolvedName || customer_email} for plan "${plan.name}" ($${plan.base_price}/${plan.frequency}). Address: ${delivery_address}. Distance: ${distanceMiles} mi. Request: ${requestNumber}.`,
      deep_link: "/admin/orders",
      idempotency_key: `zone3_sub_admin_notify_${dar.id}`
    }).catch(() => {
    });
    return Response.json({
      success: true,
      dar_id: dar.id,
      request_number: requestNumber,
      status: dar.status,
      setup_intent_client_secret: setupIntentClientSecret
    });
  } catch (error) {
    console.error("[Zone3SubReview] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/createSubscriptionPaymentElementIntent/entry.ts
import { createClientFromRequest as createClientFromRequest20 } from "npm:@base44/sdk@0.8.25";
import Stripe7 from "npm:stripe@14.21.0";
var ORIGIN_ADDRESS_SUB = "619 N Main St, O'Fallon, MO 63366";
var ZONE_RULES_SUB = [
  { zone_key: "zone_1_core", zone_type: "core", min: 0, max: 15, delivery_fee: 5.99, minimum_order: null, checkout_allowed: true, manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: "zone_2_extended", zone_type: "extended", min: 15.01, max: 25, delivery_fee: 9.99, minimum_order: 49.99, checkout_allowed: true, manual_capture_required: false, allowed_for_subscriptions: true },
  { zone_key: "zone_3_route_review", zone_type: "route_review", min: 25.01, max: 30, delivery_fee: 12.99, minimum_order: 59.99, checkout_allowed: true, manual_capture_required: true, allowed_for_subscriptions: false },
  { zone_key: "zone_3_route_review", zone_type: "route_review", min: 30.01, max: 35, delivery_fee: 15.99, minimum_order: 72, checkout_allowed: true, manual_capture_required: true, allowed_for_subscriptions: false },
  { zone_key: "waitlist_only", zone_type: "waitlist_only", min: 35.01, max: 99999, delivery_fee: null, minimum_order: null, checkout_allowed: false, manual_capture_required: false, allowed_for_subscriptions: false }
];
async function getSubDeliveryEligibility(address, cartSubtotal, orderType) {
  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not configured");
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN_ADDRESS_SUB)}&destinations=${encodeURIComponent(address)}&units=imperial&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`Maps API status: ${data.status}`);
  const element = data.rows?.[0]?.elements?.[0];
  if (element?.status !== "OK") throw new Error(`Maps element status: ${element?.status}`);
  const distanceMiles = Math.round(element.distance.value / 1609.344 * 10) / 10;
  const driveTimeMinutes = Math.round(element.duration.value / 60);
  const zone = ZONE_RULES_SUB.find((z) => distanceMiles >= z.min && distanceMiles <= z.max) || ZONE_RULES_SUB[ZONE_RULES_SUB.length - 1];
  const minimumMet = !zone.minimum_order || cartSubtotal >= zone.minimum_order;
  const amountNeeded = minimumMet ? 0 : Math.round((zone.minimum_order - cartSubtotal) * 100) / 100;
  let checkoutAllowed = zone.checkout_allowed;
  let reasonCode = "ELIGIBLE";
  if (!checkoutAllowed) reasonCode = zone.zone_type === "waitlist_only" ? "WAITLIST_ONLY" : "ZONE_BLOCKED";
  else if (!minimumMet) {
    checkoutAllowed = false;
    reasonCode = "MINIMUM_ORDER_NOT_MET";
  } else if (!zone.allowed_for_subscriptions && orderType === "subscription") {
    checkoutAllowed = false;
    reasonCode = "SUBSCRIPTION_NOT_AVAILABLE_IN_ZONE";
  } else if (zone.zone_type === "route_review") reasonCode = "ROUTE_REVIEW_REQUIRED";
  return {
    eligible: checkoutAllowed,
    checkout_allowed: checkoutAllowed,
    zone_key: zone.zone_key,
    zone_type: zone.zone_type,
    delivery_fee: zone.delivery_fee,
    minimum_order: zone.minimum_order,
    minimum_order_met: minimumMet,
    amount_needed: amountNeeded,
    estimated_distance_miles: distanceMiles,
    estimated_drive_time_minutes: driveTimeMinutes,
    distance_confidence: "driving",
    manual_capture_required: zone.manual_capture_required,
    allowed_for_subscriptions: zone.allowed_for_subscriptions,
    subscription_route_review_required: zone.zone_type === "route_review" && orderType === "subscription",
    reason_code: reasonCode
  };
}
var stripe7 = new Stripe7(Deno.env.get("STRIPE_SECRET_KEY"));
async function authorizeCheckoutCustomer3(base44, customerEmail) {
  const user = await base44.auth.me().catch(() => null);
  const requested = String(customerEmail || "").trim().toLowerCase();
  const requester = String(user?.email || "").trim().toLowerCase();
  if (!user?.email || !requested) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role === "admin" || requester === requested) return null;
  return Response.json({ error: "forbidden" }, { status: 403 });
}
async function handler20(req) {
  try {
    if (Deno.env.get("ENABLE_SUBSCRIPTION_CHECKOUTS") !== "true") {
      return Response.json({
        success: false,
        skipped: true,
        gate: "ENABLE_SUBSCRIPTION_CHECKOUTS",
        reason: "subscription_checkouts_disabled",
        message: "Subscription checkout is currently unavailable. One-time orders are still available."
      }, { status: 409 });
    }
    if (Deno.env.get("ENABLE_NATIVE_SUBSCRIPTION_FULFILLMENT") !== "true") {
      return Response.json({
        success: false,
        skipped: true,
        gate: "ENABLE_NATIVE_SUBSCRIPTION_FULFILLMENT",
        reason: "native_subscription_fulfillment_not_ready",
        message: "Subscription checkout is currently unavailable. One-time orders are still available."
      }, { status: 503 });
    }
    const base44 = createClientFromRequest20(req);
    const {
      plan_id,
      bundle_id,
      customer_email,
      contact_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      delivery_address
    } = await req.json();
    const unauthorized = await authorizeCheckoutCustomer3(base44, customer_email);
    if (unauthorized) return unauthorized;
    if (!plan_id || !customer_email) {
      return Response.json({ error_code: "MISSING_PARAMS", error: "Missing plan_id or customer_email" }, { status: 400 });
    }
    let customer_name = "";
    let profileFound = false;
    try {
      const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
      if (profiles[0]) {
        profileFound = true;
        const { first_name, last_name } = profiles[0];
        customer_name = [first_name, last_name].filter(Boolean).join(" ");
        console.log(`[SubPE] Profile found for ${customer_email}: first_name="${first_name}" last_name="${last_name}" \u2192 customer_name="${customer_name}"`);
      } else {
        console.warn(`[SubPE] No UserProfile found for ${customer_email}`);
      }
    } catch (err) {
      console.warn(`[SubPE] Failed to fetch UserProfile: ${err.message}`);
    }
    if (!profileFound) {
      return Response.json({ error_code: "MISSING_PROFILE", error: "Profile not found. Please complete your account setup before subscribing." }, { status: 400 });
    }
    if (!customer_name?.trim()) {
      return Response.json({ error_code: "MISSING_NAME", error: "Your profile is missing a name. Please update your profile (first and last name) before subscribing." }, { status: 400 });
    }
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (!plans[0]) return Response.json({ error_code: "PLAN_NOT_FOUND", error: "Subscription plan not found" }, { status: 404 });
    const plan = plans[0];
    if (!plan.stripe_price_id) {
      return Response.json({ error_code: "MISSING_STRIPE_PRICE_ID", error: "This subscription plan is not yet available for purchase. Please contact support." }, { status: 400 });
    }
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ customer_email });
    const hasActiveSub = existingSubs.some((s) => s.plan_id === plan_id && s.status === "active");
    if (hasActiveSub) {
      return Response.json({ error_code: "ALREADY_SUBSCRIBED", error: "You already have an active subscription with this plan." }, { status: 400 });
    }
    try {
      const stripeCustomersCheck = await stripe7.customers.list({ email: customer_email, limit: 1 });
      const existingStripeCustomer = stripeCustomersCheck.data[0];
      if (existingStripeCustomer) {
        const activeStripeSubs = await stripe7.subscriptions.list({
          customer: existingStripeCustomer.id,
          status: "active",
          limit: 10
        });
        if (activeStripeSubs.data.length > 0) {
          const activeSubId = activeStripeSubs.data[0].id;
          console.warn(`[SubPE] Stripe has active sub ${activeSubId} for ${customer_email}. CA record may be missing. Blocking checkout and triggering reconciliation.`);
          return Response.json({
            error_code: "ALREADY_SUBSCRIBED_OR_ACTIVATING",
            error: "You already have an active subscription. If you don't see it yet, it may still be activating \u2014 please check My Subscriptions in a moment or contact support."
          }, { status: 400 });
        }
        const pendingStripeSubs = await stripe7.subscriptions.list({
          customer: existingStripeCustomer.id,
          status: "past_due",
          limit: 5
        });
        if (pendingStripeSubs.data.length > 0) {
          console.warn(`[SubPE] Stripe has ${pendingStripeSubs.data.length} past_due sub(s) for ${customer_email}. Blocking new checkout.`);
          return Response.json({
            error_code: "ALREADY_SUBSCRIBED_OR_ACTIVATING",
            error: "You have a subscription with a payment issue. Please check My Subscriptions or contact support to resolve it."
          }, { status: 400 });
        }
      }
    } catch (stripeCheckErr) {
      console.warn(`[SubPE] Stripe active sub check failed (non-blocking): ${stripeCheckErr.message}`);
    }
    try {
      const incompleteList = await stripe7.subscriptions.list({
        customer: (await stripe7.customers.list({ email: customer_email, limit: 1 })).data[0]?.id || "__none__",
        status: "incomplete",
        limit: 5
      });
      for (const incompleteSub of incompleteList.data) {
        if (incompleteSub.metadata?.plan_id !== plan_id) continue;
        if (incompleteSub.metadata?.source_app !== "customer_app") continue;
        const invoice2 = await stripe7.invoices.retrieve(incompleteSub.latest_invoice, {
          expand: ["payment_intent"]
        });
        const existingPi = invoice2.payment_intent;
        if (existingPi?.client_secret) {
          console.log(`[SubPE] Reusing existing incomplete subscription ${incompleteSub.id} / PI ${existingPi.id} for ${customer_email}`);
          const existingPending = await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({
            stripe_subscription_id: incompleteSub.id,
            customer_email
          }).catch(() => []);
          const pendingRecord = existingPending[0];
          return Response.json({
            success: true,
            paymentIntentClientSecret: existingPi.client_secret,
            stripeSubscriptionId: incompleteSub.id,
            pendingCheckoutId: pendingRecord?.id || null,
            publishableKey: Deno.env.get("STRIPE_PUBLISHABLE_KEY"),
            planName: plan.name,
            amountDue: (invoice2.amount_due || 0) / 100,
            reused: true
          });
        }
      }
    } catch (reuseErr) {
      console.warn(`[SubPE] Incomplete subscription reuse check failed: ${reuseErr.message} \u2014 proceeding to create new`);
    }
    const resolvedAddress = delivery_address || [address_line1, address_city, address_state, address_postal_code].filter(Boolean).join(", ");
    let eligibility = null;
    try {
      eligibility = await getSubDeliveryEligibility(resolvedAddress, plan.base_price || 0, "subscription");
    } catch (eligErr) {
      console.error(`[SubPE] Eligibility check failed: ${eligErr.message}`);
      return Response.json({ error: "Could not verify delivery eligibility. Please try again." }, { status: 400 });
    }
    console.log(`[SubPE] Eligibility: zone=${eligibility.zone_key}, checkout_allowed=${eligibility.checkout_allowed}, reason=${eligibility.reason_code}`);
    if (!eligibility.checkout_allowed) {
      return Response.json({
        error_code: eligibility.reason_code || "DELIVERY_NOT_AVAILABLE",
        error: eligibility.customer_message || "Delivery is not available to this address.",
        zone_key: eligibility.zone_key,
        zone_type: eligibility.zone_type,
        amount_needed: eligibility.amount_needed || 0
      }, { status: 400 });
    }
    if (eligibility.zone_type === "route_review" || eligibility.subscription_route_review_required) {
      return Response.json({
        error_code: "SUBSCRIPTION_NOT_AVAILABLE_IN_ZONE",
        error: eligibility.customer_message || "Subscriptions are not available for your delivery area at this time. Contact us to be notified when your area opens.",
        zone_key: eligibility.zone_key,
        zone_type: eligibility.zone_type,
        subscription_route_review_required: true
      }, { status: 400 });
    }
    const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true });
    const matchedZone = allZones.find((z) => z.zone_key === eligibility.zone_key) || allZones[0] || null;
    const delivery_zone_id = matchedZone?.id || null;
    const now = /* @__PURE__ */ new Date();
    let fulfillmentCalc;
    try {
      const scheduleResp = await base44.asServiceRole.functions.invoke("calculateNuViraFulfillmentSchedule", {
        created_at: now.toISOString()
      });
      const scheduleResult = scheduleResp.data || scheduleResp;
      const nextDeliveryDate = new Date(scheduleResult.delivery_date);
      if (plan.frequency === "weekly") {
        nextDeliveryDate.setDate(nextDeliveryDate.getDate() + 7);
      } else {
        nextDeliveryDate.setMonth(nextDeliveryDate.getMonth() + 1);
      }
      fulfillmentCalc = {
        production_date: scheduleResult.production_date,
        first_delivery_date: scheduleResult.delivery_date,
        next_delivery_date: nextDeliveryDate.toISOString().split("T")[0],
        delivery_window_label: scheduleResult.delivery_window_label,
        delivery_window_start: scheduleResult.delivery_window_start,
        delivery_window_end: scheduleResult.delivery_window_end,
        reason: scheduleResult.schedule_reason,
        order_date: scheduleResult.production_date,
        order_time: now.toTimeString().substring(0, 5),
        cutoff_window_label: scheduleResult.cutoff_window_label
      };
    } catch (schedErr) {
      console.error(`[SubPE] Schedule calculation failed: ${schedErr.message}`);
      return Response.json({ error: "Failed to calculate delivery schedule. Please try again." }, { status: 500 });
    }
    console.log(`[SubPE] Fulfillment: production=${fulfillmentCalc.production_date}, first_delivery=${fulfillmentCalc.first_delivery_date}, reason=${fulfillmentCalc.reason}`);
    const customers = await stripe7.customers.list({ email: customer_email, limit: 1 });
    const stripeCustomer = customers.data[0] || await stripe7.customers.create({
      email: customer_email,
      name: customer_name,
      phone: contact_phone || void 0,
      metadata: { source_app: "customer_app" }
    });
    console.log(`[SubPE] Stripe customer: ${stripeCustomer.id}`);
    const planComposition = plan.composition_template?.bottles_per_delivery || [];
    const products = planComposition.map((b) => ({ product_name: b.flavor || "Juice", quantity: b.quantity || 1 }));
    const billingCadence = plan.frequency || "monthly";
    const fulfillmentsPerCycle = plan.composition_template?.deliveries_per_cycle || (billingCadence === "monthly" ? 4 : 1);
    const itemsSummaryStr = products.length > 0 ? products.map((p) => `${p.quantity}x ${p.product_name}`).join(", ") : plan.name;
    const sharedMetadata = {
      base44_app_id: Deno.env.get("BASE44_APP_ID"),
      source_app: "customer_app",
      checkout_version: "4.0_payment_element",
      checkout_type: "subscription",
      source_type: "subscription_fulfillment",
      order_type: "subscription",
      customer_email: customer_email || "",
      customer_name: customer_name || "",
      customer_phone: contact_phone || "",
      plan_id,
      plan_name: plan.name,
      billing_cadence: billingCadence,
      fulfillment_cadence: "weekly",
      fulfillment_number: "1",
      fulfillments_per_cycle: String(fulfillmentsPerCycle),
      production_date: fulfillmentCalc.production_date,
      first_delivery_date: fulfillmentCalc.first_delivery_date,
      selected_delivery_date: fulfillmentCalc.first_delivery_date,
      requested_delivery_date: fulfillmentCalc.first_delivery_date,
      delivery_window_label: fulfillmentCalc.delivery_window_label,
      delivery_window_start: fulfillmentCalc.delivery_window_start,
      delivery_window_end: fulfillmentCalc.delivery_window_end,
      schedule_reason: fulfillmentCalc.reason,
      cutoff_window_label: fulfillmentCalc.cutoff_window_label || "",
      schedule_timezone: "America/Chicago",
      items_summary: itemsSummaryStr,
      delivery_address: resolvedAddress,
      delivery_address_line1: address_line1 || "",
      delivery_address_line2: address_line2 || "",
      delivery_city: address_city || "",
      delivery_state: address_state || "",
      delivery_postal_code: address_postal_code || "",
      delivery_zone_id: delivery_zone_id || "",
      bundle_id: bundle_id || "",
      // Zone eligibility fields
      delivery_zone_key: eligibility?.zone_key || "",
      delivery_zone_name: eligibility?.zone_name || "",
      delivery_zone_type: eligibility?.zone_type || "",
      delivery_zone_fee: eligibility ? String(eligibility.delivery_fee ?? "") : "",
      estimated_distance_miles: eligibility ? String(eligibility.estimated_distance_miles ?? "") : "",
      distance_confidence: eligibility?.distance_confidence || "",
      zone_origin_address: "619 N Main St, O'Fallon, MO 63366",
      eligibility_reason_code: eligibility?.reason_code || ""
    };
    let pendingCheckout = null;
    try {
      pendingCheckout = await base44.asServiceRole.entities.PendingSubscriptionCheckout.create({
        customer_email,
        customer_name,
        customer_phone: contact_phone || "",
        plan_id,
        plan_name: plan.name,
        cadence: billingCadence,
        bundle_id: bundle_id || null,
        delivery_address: resolvedAddress,
        address_line1: address_line1 || "",
        address_line2: address_line2 || "",
        address_city: address_city || "",
        address_state: address_state || "",
        address_postal_code: address_postal_code || "",
        address_country: "US",
        delivery_zone_id,
        products,
        order_timestamp: now.toISOString(),
        order_date: fulfillmentCalc.order_date,
        order_time: fulfillmentCalc.order_time,
        production_date: fulfillmentCalc.production_date,
        first_delivery_date: fulfillmentCalc.first_delivery_date,
        next_delivery_date: fulfillmentCalc.next_delivery_date,
        delivery_window_label: fulfillmentCalc.delivery_window_label,
        delivery_window_start: fulfillmentCalc.delivery_window_start,
        delivery_window_end: fulfillmentCalc.delivery_window_end,
        date_calculation_reason: fulfillmentCalc.reason,
        date_calculation_version: "v2_may_2026",
        stripe_customer_id: stripeCustomer.id,
        fulfillment_cadence: "weekly",
        fulfillments_per_cycle: fulfillmentsPerCycle,
        fulfillment_number: 1,
        items_summary: itemsSummaryStr,
        decomposition_version: "v2_weekly_decomposed",
        status: "pending"
      });
      console.log(`[SubPE] Created PendingSubscriptionCheckout: ${pendingCheckout.id}`);
    } catch (pendingErr) {
      console.error(`[SubPE] Failed to create PendingSubscriptionCheckout: ${pendingErr.message}`);
      return Response.json({ error: "Failed to prepare subscription checkout. Please try again." }, { status: 500 });
    }
    const metadataWithPendingId = {
      ...sharedMetadata,
      pending_subscription_checkout_id: pendingCheckout.id
    };
    const subscription = await stripe7.subscriptions.create({
      customer: stripeCustomer.id,
      items: [{ price: plan.stripe_price_id }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"]
      },
      expand: ["latest_invoice.payment_intent"],
      metadata: metadataWithPendingId
    });
    const invoice = subscription.latest_invoice;
    const paymentIntent = invoice?.payment_intent;
    if (!paymentIntent?.client_secret) {
      console.error(`[SubPE] No client_secret on PaymentIntent for subscription ${subscription.id}`);
      await stripe7.subscriptions.cancel(subscription.id).catch(() => {
      });
      return Response.json({ error: "Failed to initialize payment. Please try again." }, { status: 500 });
    }
    await stripe7.paymentIntents.update(paymentIntent.id, {
      metadata: metadataWithPendingId
    }).catch((err) => console.warn(`[SubPE] Failed to update PI metadata: ${err.message}`));
    await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingCheckout.id, {
      stripe_checkout_session_id: subscription.id,
      // reuse field for stripe_subscription_id reference
      stripe_subscription_id: subscription.id,
      stripe_customer_id: stripeCustomer.id
    }).catch((err) => console.warn(`[SubPE] Failed to update pending checkout: ${err.message}`));
    console.log(`[SubPE] Subscription ${subscription.id} created (incomplete), PI ${paymentIntent.id} ready for ${customer_email}`);
    return Response.json({
      success: true,
      paymentIntentClientSecret: paymentIntent.client_secret,
      stripeSubscriptionId: subscription.id,
      pendingCheckoutId: pendingCheckout.id,
      publishableKey: Deno.env.get("STRIPE_PUBLISHABLE_KEY"),
      planName: plan.name,
      amountDue: (invoice.amount_due || 0) / 100
    });
  } catch (error) {
    console.error("[SubPE] Error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/manageProgramJourney/entry.ts
import { createClientFromRequest as createClientFromRequest21 } from "npm:@base44/sdk@0.8.25";
var TIMEZONE = "America/Chicago";
var SCHEDULE_VERSION = "2026-08-09.v2";
var QUALITY_TARGET_DAYS = 5;
var OUTER_FRESHNESS_DAYS = 7;
var MAX_ORDER_ROWS = 40;
var MAX_BATCH_ROWS = 120;
var MAX_PROGRAM_UNITS_PER_LINE = 6;
function programReminderServiceEnabled() {
  return String(Deno.env.get("ENABLE_PROGRAM_JOURNEY_REMINDERS") || "").trim().toLowerCase() === "true";
}
var PROGRAMS = Object.freeze({
  radiance: {
    name: "Radiance",
    allowedDays: [2, 3],
    image: "https://media.base44.com/images/public/69d48d0c39891f7945481152/32667c02e_DSC02688.jpg",
    schedule: [
      ["morning", "Morning", "8:00 AM", "AURA"],
      ["midday", "Midday", "12:30 PM", "OASIS"],
      ["golden_hour", "Golden Hour", "4:30 PM", "AURA"],
      ["evening", "Evening", "8:00 PM", "AURA"]
    ]
  },
  hydration: {
    name: "Hydration",
    allowedDays: [2, 3],
    image: "https://media.base44.com/images/public/69d48d0c39891f7945481152/bc50c9427_DSC02532.jpg",
    schedule: [
      ["morning", "Morning", "8:00 AM", "OASIS"],
      ["midday", "Midday", "12:30 PM", "AURA"],
      ["golden_hour", "Golden Hour", "4:30 PM", "OASIS"],
      ["evening", "Evening", "8:00 PM", "OASIS"]
    ]
  },
  reset: {
    name: "Reset",
    allowedDays: [3],
    image: "https://media.base44.com/images/public/69d48d0c39891f7945481152/3e9fe43e6_DSC02709.jpg",
    schedule: [
      ["morning", "Morning", "8:00 AM", "RE-NU"],
      ["midday", "Midday", "12:30 PM", "OASIS"],
      ["golden_hour", "Golden Hour", "4:30 PM", "RE-NU"],
      ["evening", "Evening", "8:00 PM", "RE-NU"]
    ]
  }
});
function clean(value, max = 300) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}
function email(value) {
  return clean(value, 320).toLowerCase();
}
function validDateKey(value) {
  const normalized = clean(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = /* @__PURE__ */ new Date(`${normalized}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? normalized : null;
}
function addDays(dateKey, days) {
  const date = /* @__PURE__ */ new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function earlierDate(...values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] || null;
}
function dateKeyInTimezone(value = /* @__PURE__ */ new Date()) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  const safe = Number.isFinite(date.getTime()) ? date : /* @__PURE__ */ new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(safe);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
function programForItem(item) {
  const productId = clean(item?.product_id || item?.id, 160).toLowerCase();
  const title = clean(item?.title || item?.name, 240).toLowerCase();
  for (const [key, program] of Object.entries(PROGRAMS)) {
    const explicitKey = clean(item?.program_key, 60).toLowerCase();
    if (explicitKey === key || productId === `program_${key}` || productId === `program-${key}` || productId.startsWith(`program_${key}_`) || productId.startsWith(`program-${key}-`) || title.includes(`${program.name.toLowerCase()} program`)) {
      const idMatch = productId.match(/[_-](2|3)day$/);
      const titleMatch = title.match(/\((2|3)-day\)/);
      const requestedDays = Number(item?.program_days || idMatch?.[1] || titleMatch?.[1] || 3);
      const days = program.allowedDays.includes(requestedDays) ? requestedDays : 3;
      return { key, ...program, days };
    }
  }
  return null;
}
function paidDeliveredOrder(order) {
  const paymentState = clean(order?.payment_status || order?.financial_status, 60).toLowerCase();
  const refundState = clean(order?.refund_status, 60).toLowerCase();
  const lifecycle = clean(order?.status, 60).toLowerCase();
  const paid = order?.payment_captured === true || paymentState === "paid";
  const refunded = paymentState === "refunded" || ["fully_refunded", "partially_refunded"].includes(refundState);
  return paid && !refunded && lifecycle === "delivered";
}
function deliveredDate(order) {
  const deliveredAt = clean(order?.delivered_at, 80);
  const actual = validDateKey(deliveredAt) || (deliveredAt ? dateKeyInTimezone(deliveredAt) : null);
  const explicit = actual || validDateKey(order?.assigned_delivery_date) || validDateKey(order?.estimated_delivery_date);
  return explicit || dateKeyInTimezone(order?.delivered_at || order?.updated_date || order?.created_date);
}
async function resolveIdentities2(base44, authEmail) {
  const identities = /* @__PURE__ */ new Set([email(authEmail)]);
  const addProfile = (profile) => {
    const customer = email(profile?.customer_email);
    const contact = email(profile?.contact_email);
    if (customer) identities.add(customer);
    if (contact) identities.add(contact);
  };
  try {
    const [forward, reverse] = await Promise.all([
      base44.asServiceRole.entities.UserProfile.filter({ customer_email: authEmail }, "-updated_date", 5),
      base44.asServiceRole.entities.UserProfile.filter({ contact_email: authEmail }, "-updated_date", 5)
    ]);
    [...forward, ...reverse].forEach(addProfile);
  } catch (error) {
    console.warn(`[manageProgramJourney] Identity resolution partial failure: ${clean(error?.message || error, 200)}`);
  }
  return [...identities].filter(Boolean);
}
async function eligibleOrders(base44, identities) {
  const byId = /* @__PURE__ */ new Map();
  for (const identity of identities) {
    const rows = await base44.asServiceRole.entities.Order.filter(
      { customer_email: identity },
      "-created_date",
      MAX_ORDER_ROWS
    );
    for (const row of rows) {
      if (row?.id && paidDeliveredOrder(row) && Array.isArray(row?.items) && row.items.some(programForItem)) {
        byId.set(row.id, row);
      }
    }
  }
  return [...byId.values()];
}
function batchReferencesOrder(batch, order) {
  const orderId = clean(order?.id, 160);
  const orderNumber = clean(order?.order_number, 160).toLowerCase().replace(/^#/, "");
  const sources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];
  if (sources.some((source) => {
    const sourceId = clean(source?.order_id, 160);
    const sourceNumber = clean(source?.order_number, 160).toLowerCase().replace(/^#/, "");
    return orderId && sourceId === orderId || orderNumber && sourceNumber === orderNumber;
  })) return true;
  return Array.isArray(batch?.related_orders) && batch.related_orders.some((value) => clean(value, 160) === orderId);
}
async function useByDatesByOrder(base44, orders) {
  const result = /* @__PURE__ */ new Map();
  const dates = [...new Set(orders.map((order) => validDateKey(order?.assigned_production_day || order?.production_date)).filter(Boolean))];
  const batches = [];
  for (const date of dates.slice(0, 12)) {
    const rows = await base44.asServiceRole.entities.ProductionBatch.filter(
      { production_date: date },
      "-created_date",
      MAX_BATCH_ROWS
    ).catch(() => []);
    batches.push(...rows.filter((row) => row?.is_test_batch !== true));
  }
  for (const order of orders) {
    const useByDates = batches.filter((batch) => batchReferencesOrder(batch, order)).map((batch) => validDateKey(batch?.use_by_date)).filter(Boolean).sort();
    if (useByDates[0]) result.set(order.id, useByDates[0]);
  }
  return result;
}
function expandedShots(order) {
  const shots = [];
  for (const item of Array.isArray(order?.items) ? order.items : []) {
    if (clean(item?.category, 60).toLowerCase() !== "shot") continue;
    const quantity = Math.min(12, Math.max(1, Math.trunc(Number(item?.quantity || 1))));
    const requestedProgramKey = clean(item?.program_addon_for, 60).toLowerCase();
    const programKey = PROGRAMS[requestedProgramKey] ? requestedProgramKey : null;
    for (let index = 0; index < quantity; index += 1) {
      shots.push({
        name: clean(item?.title, 120) || "Wellness shot",
        program_key: programKey
      });
    }
  }
  return shots;
}
function descriptorsForOrder(order, linkedUseByDate) {
  const delivered = deliveredDate(order);
  const estimatedUseBy = addDays(delivered, OUTER_FRESHNESS_DAYS - 1);
  const useBy = linkedUseByDate || estimatedUseBy;
  const qualityTarget = earlierDate(addDays(delivered, QUALITY_TARGET_DAYS - 1), useBy);
  const shots = expandedShots(order);
  const unassignedShots = shots.filter((shot) => !shot.program_key).map((shot) => shot.name);
  const assignedShots = new Map(Object.keys(PROGRAMS).map((key) => [
    key,
    shots.filter((shot) => shot.program_key === key).map((shot) => shot.name)
  ]));
  const descriptors = [];
  const items = Array.isArray(order?.items) ? order.items : [];
  items.forEach((item, itemIndex) => {
    const program = programForItem(item);
    if (!program) return;
    const latestStart = earlierDate(qualityTarget, addDays(useBy, -(program.days - 1)));
    const units = Math.min(MAX_PROGRAM_UNITS_PER_LINE, Math.max(1, Math.trunc(Number(item?.quantity || 1))));
    for (let unitIndex = 0; unitIndex < units; unitIndex += 1) {
      const programShots = assignedShots.get(program.key) || [];
      const morningShots = programShots.splice(0, program.days);
      while (morningShots.length < program.days && unassignedShots.length > 0) {
        morningShots.push(unassignedShots.shift());
      }
      descriptors.push({
        journey_key: `program:${order.id}:${itemIndex}:${unitIndex}`,
        customer_email: email(order.customer_email),
        order_id: order.id,
        order_number: clean(order.order_number, 120),
        order_item_index: itemIndex,
        unit_index: unitIndex,
        program_key: program.key,
        program_name: program.name,
        program_days: program.days,
        program_image_url: clean(item?.image_url, 1200) || program.image,
        delivered_at: order.delivered_at || null,
        delivered_date: delivered,
        quality_target_date: qualityTarget,
        use_by_date: useBy,
        use_by_source: linkedUseByDate ? "production_batch" : "delivery_estimate",
        latest_start_date: latestStart,
        morning_shots: morningShots
      });
    }
  });
  return descriptors;
}
function freshnessState(journey, today = dateKeyInTimezone()) {
  if (today > journey.use_by_date) return "ended";
  if (!journey.start_date && today > journey.latest_start_date) return "cannot_finish";
  if (today > journey.quality_target_date) return "quality_target_passed";
  return "within_quality_target";
}
function publicJourney(descriptor, stored = null) {
  const merged = {
    ...stored || {},
    ...descriptor,
    id: stored?.id || descriptor.journey_key,
    is_virtual: !stored,
    status: stored?.status || (dateKeyInTimezone() > descriptor.latest_start_date ? "freshness_window_ended" : "ready"),
    schedule: Array.isArray(stored?.schedule) ? stored.schedule : [],
    completed_steps: Number(stored?.completed_steps || 0),
    total_steps: Number(stored?.total_steps || Number(descriptor.program_days || 3) * 4),
    reminders_enabled: stored?.reminders_enabled === true
  };
  return {
    id: merged.id,
    journey_key: merged.journey_key,
    order_id: merged.order_id,
    order_number: merged.order_number,
    program_key: merged.program_key,
    program_name: merged.program_name,
    program_days: Number(merged.program_days || 3),
    program_image_url: merged.program_image_url,
    status: merged.status,
    is_virtual: merged.is_virtual,
    delivered_at: merged.delivered_at || null,
    delivered_date: merged.delivered_date,
    quality_target_date: merged.quality_target_date,
    use_by_date: merged.use_by_date,
    use_by_source: merged.use_by_source,
    latest_start_date: merged.latest_start_date,
    freshness_state: freshnessState(merged),
    start_date: merged.start_date || null,
    started_at: merged.started_at || null,
    completed_at: merged.completed_at || null,
    timezone: merged.timezone || TIMEZONE,
    schedule_version: merged.schedule_version || SCHEDULE_VERSION,
    schedule: merged.schedule,
    completed_steps: merged.completed_steps,
    total_steps: merged.total_steps,
    reminders_enabled: merged.reminders_enabled,
    reminder_delivery_available: programReminderServiceEnabled(),
    today: dateKeyInTimezone()
  };
}
function buildSchedule(descriptor, startDate) {
  const program = PROGRAMS[descriptor.program_key];
  const shots = Array.isArray(descriptor.morning_shots) ? descriptor.morning_shots : [];
  const schedule = [];
  for (let day = 1; day <= Number(descriptor.program_days || 3); day += 1) {
    const date = addDays(startDate, day - 1);
    program.schedule.forEach(([timeKey, timeLabel, suggestedTime, productName], sequence) => {
      schedule.push({
        step_id: `day-${day}-${timeKey}`,
        day_number: day,
        date,
        sequence: sequence + 1,
        time_key: timeKey,
        time_label: timeLabel,
        suggested_time: suggestedTime,
        product_name: productName,
        morning_shot_name: timeKey === "morning" ? shots[day - 1] || null : null,
        completed_at: null
      });
    });
  }
  return schedule;
}
async function loadContext(base44, authEmail) {
  const identities = await resolveIdentities2(base44, authEmail);
  const orders = await eligibleOrders(base44, identities);
  const useByMap = await useByDatesByOrder(base44, orders);
  const descriptors = orders.flatMap((order) => descriptorsForOrder(order, useByMap.get(order.id) || null));
  const storedRows = [];
  for (const identity of identities) {
    const rows = await base44.asServiceRole.entities.ProgramJourney.filter(
      { customer_email: identity },
      "-created_date",
      50
    ).catch(() => []);
    storedRows.push(...rows);
  }
  const storedByKey = new Map(storedRows.map((row) => [row.journey_key, row]));
  return { identities, descriptors, storedByKey };
}
function requestedJourney(context, body) {
  const requestedId = clean(body?.journey_id || body?.journey_key, 240);
  const descriptor = context.descriptors.find((row) => row.journey_key === requestedId) || context.descriptors.find((row) => context.storedByKey.get(row.journey_key)?.id === requestedId);
  if (!descriptor) return null;
  return { descriptor, stored: context.storedByKey.get(descriptor.journey_key) || null };
}
function withCommand(row, commandId) {
  const recent = Array.isArray(row?.recent_command_ids) ? row.recent_command_ids.map(String) : [];
  return [.../* @__PURE__ */ new Set([...recent, commandId])].slice(-20);
}
async function handler21(req) {
  try {
    if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
    const base44 = createClientFromRequest21(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: "Unauthorized" }, { status: 401 });
    let body = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "malformed_json" }, { status: 400 });
    }
    const action = clean(body?.action || "list", 60).toLowerCase();
    const context = await loadContext(base44, email(user.email));
    if (action === "list") {
      const journeys = context.descriptors.map((descriptor2) => publicJourney(descriptor2, context.storedByKey.get(descriptor2.journey_key) || null)).sort((a, b) => String(b.delivered_date).localeCompare(String(a.delivered_date)));
      return Response.json({
        journeys,
        summary: {
          ready: journeys.filter((row) => row.status === "ready").length,
          in_progress: journeys.filter((row) => row.status === "in_progress").length,
          completed: journeys.filter((row) => row.status === "completed").length
        },
        policy: {
          quality_target_days: QUALITY_TARGET_DAYS,
          outer_freshness_days: OUTER_FRESHNESS_DAYS,
          bottle_date_is_authoritative: true,
          reminder_delivery_available: programReminderServiceEnabled(),
          timezone: TIMEZONE
        }
      });
    }
    const target = requestedJourney(context, body);
    if (!target) return Response.json({ error: "program_journey_not_found_or_ineligible" }, { status: 404 });
    const { descriptor } = target;
    if (action === "get") return Response.json({ journey: publicJourney(descriptor, target.stored) });
    const commandId = clean(body?.command_id, 160);
    if (!commandId) return Response.json({ error: "command_id_required" }, { status: 400 });
    if (target.stored?.recent_command_ids?.map(String).includes(commandId)) {
      return Response.json({ success: true, idempotent_replay: true, journey: publicJourney(descriptor, target.stored) });
    }
    if (action === "start") {
      if (target.stored?.status && target.stored.status !== "ready") {
        return Response.json({ error: "program_journey_already_started", journey: publicJourney(descriptor, target.stored) }, { status: 409 });
      }
      const startDate = validDateKey(body?.start_date);
      const today = dateKeyInTimezone();
      if (!startDate || startDate < today || startDate < descriptor.delivered_date || startDate > descriptor.latest_start_date) {
        return Response.json({
          error: "start_date_outside_freshness_window",
          earliest_start_date: today > descriptor.delivered_date ? today : descriptor.delivered_date,
          latest_start_date: descriptor.latest_start_date,
          use_by_date: descriptor.use_by_date
        }, { status: 409 });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const payload = {
        ...descriptor,
        morning_shots: void 0,
        status: "in_progress",
        start_date: startDate,
        started_at: now,
        completed_at: null,
        timezone: TIMEZONE,
        schedule_version: SCHEDULE_VERSION,
        schedule: buildSchedule(descriptor, startDate),
        completed_steps: 0,
        total_steps: Number(descriptor.program_days || 3) * PROGRAMS[descriptor.program_key].schedule.length,
        reminders_enabled: programReminderServiceEnabled() && body?.reminders_enabled === true,
        recent_command_ids: withCommand(target.stored || {}, commandId)
      };
      const saved = target.stored?.id ? await base44.asServiceRole.entities.ProgramJourney.update(target.stored.id, payload) : await base44.asServiceRole.entities.ProgramJourney.create(payload);
      return Response.json({ success: true, journey: publicJourney(descriptor, saved) });
    }
    if (!target.stored?.id) return Response.json({ error: "program_journey_not_started" }, { status: 409 });
    if (action === "toggle_step") {
      if (!["in_progress", "completed"].includes(target.stored.status)) {
        return Response.json({ error: "program_journey_not_active" }, { status: 409 });
      }
      const stepId = clean(body?.step_id, 120);
      const schedule = Array.isArray(target.stored.schedule) ? target.stored.schedule.map((step) => ({ ...step })) : [];
      const index = schedule.findIndex((step) => step.step_id === stepId);
      if (index < 0) return Response.json({ error: "program_step_not_found" }, { status: 404 });
      const completing = body?.completed !== false;
      if (completing && dateKeyInTimezone() > descriptor.use_by_date) {
        return Response.json({ error: "freshness_window_ended", use_by_date: descriptor.use_by_date }, { status: 409 });
      }
      if (completing && schedule[index].date > dateKeyInTimezone()) {
        return Response.json({ error: "future_program_step_cannot_be_completed", step_date: schedule[index].date }, { status: 409 });
      }
      schedule[index].completed_at = completing ? (/* @__PURE__ */ new Date()).toISOString() : null;
      const completedSteps = schedule.filter((step) => Boolean(step.completed_at)).length;
      const complete = schedule.length > 0 && completedSteps === schedule.length;
      const saved = await base44.asServiceRole.entities.ProgramJourney.update(target.stored.id, {
        schedule,
        completed_steps: completedSteps,
        total_steps: schedule.length,
        status: complete ? "completed" : "in_progress",
        completed_at: complete ? target.stored.completed_at || (/* @__PURE__ */ new Date()).toISOString() : null,
        use_by_date: descriptor.use_by_date,
        use_by_source: descriptor.use_by_source,
        quality_target_date: descriptor.quality_target_date,
        latest_start_date: descriptor.latest_start_date,
        recent_command_ids: withCommand(target.stored, commandId)
      });
      return Response.json({ success: true, journey: publicJourney(descriptor, saved) });
    }
    if (action === "set_reminders") {
      if (body?.reminders_enabled === true && !programReminderServiceEnabled()) {
        return Response.json({ error: "program_reminder_service_unavailable" }, { status: 409 });
      }
      const saved = await base44.asServiceRole.entities.ProgramJourney.update(target.stored.id, {
        reminders_enabled: body?.reminders_enabled === true,
        recent_command_ids: withCommand(target.stored, commandId)
      });
      return Response.json({ success: true, journey: publicJourney(descriptor, saved) });
    }
    return Response.json({ error: "unsupported_program_journey_action" }, { status: 400 });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 300);
    console.error(`[manageProgramJourney] ${message}`);
    return Response.json({ error: "program_journey_failed" }, { status: 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/submitCustomerInquiry/entry.ts
import { createClientFromRequest as createClientFromRequest22 } from "npm:@base44/sdk@0.8.25";
var RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
var SUPPORT_EMAIL = "support@nuvirajuice.com";
var OPERATIONS_FROM = Deno.env.get("INTERNAL_EMAIL_FROM") || "NuVira Juice Co <operations@nuvirajuice.com>";
var SUPPORT_FROM = "NuVira Support <support@nuvirajuice.com>";
var MARKETING_FROM = Deno.env.get("MARKETING_EMAIL_FROM") || "NuVira Juice Co <hello@nuvirajuice.com>";
var MAILING_ADDRESS = "NuVira Juice Company, 619 N. Main St., O'Fallon, MO 63366";
var TYPE_LABELS = {
  contact: "General inquiry",
  support: "Support request",
  event: "Event inquiry",
  partnership: "Partnership inquiry",
  merch_waitlist: "Merch waitlist",
  delivery_waitlist: "Delivery-area waitlist"
};
function singleLine(value, max = 300) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}
function multiLine(value, max = 4e3) {
  return String(value ?? "").trim().replace(/\r\n?/g, "\n").slice(0, max);
}
function email2(value) {
  return singleLine(value, 320).toLowerCase();
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function errorMessage(error) {
  return singleLine(error instanceof Error ? error.message : String(error || "unknown"), 900);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = /* @__PURE__ */ new Set([
    "business",
    "business_type",
    "event_type",
    "event_date",
    "guest_count",
    "juice_type",
    "service_model",
    "venue",
    "postal_code",
    "delivery_address",
    "requested_area"
  ]);
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    const cleaned = singleLine(raw, 500);
    if (cleaned) output[key] = cleaned;
  }
  return output;
}
function responseWindow(type) {
  return ["event", "partnership"].includes(type) ? "within two business days" : "within one business day";
}
function acknowledgmentCopy(type, firstName) {
  if (type === "merch_waitlist") {
    return {
      subject: "You are on the NuVira merch list",
      heading: "You are on the list",
      body: "We will send one update when the next NuVira merch release is ready."
    };
  }
  if (type === "delivery_waitlist") {
    return {
      subject: "Your NuVira delivery-area request is saved",
      heading: "We saved your area request",
      body: "We will let you know when NuVira delivery becomes available in your area."
    };
  }
  return {
    subject: `We received your ${TYPE_LABELS[type].toLowerCase()}`,
    heading: "Your message is with our team",
    body: `Thank you, ${firstName}. A member of the NuVira team will respond ${responseWindow(type)}.`
  };
}
function customerEmailHtml(type, name) {
  const firstName = singleLine(name, 120).split(/\s+/)[0] || "there";
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
function internalEmailHtml(inquiry) {
  const metadata = Object.entries(inquiry.metadata || {}).map(([key, value]) => `<tr><td style="padding:6px 10px;color:#66766d;">${escapeHtml(key.replace(/_/g, " "))}</td><td style="padding:6px 10px;">${escapeHtml(value)}</td></tr>`).join("");
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#26362d;"><h1 style="color:#173f2c;">${escapeHtml(TYPE_LABELS[inquiry.inquiry_type])}</h1><table style="border-collapse:collapse;"><tr><td style="padding:6px 10px;color:#66766d;">Name</td><td style="padding:6px 10px;">${escapeHtml(inquiry.customer_name || "Not provided")}</td></tr><tr><td style="padding:6px 10px;color:#66766d;">Email</td><td style="padding:6px 10px;">${escapeHtml(inquiry.customer_email)}</td></tr><tr><td style="padding:6px 10px;color:#66766d;">Phone</td><td style="padding:6px 10px;">${escapeHtml(inquiry.customer_phone || "Not provided")}</td></tr><tr><td style="padding:6px 10px;color:#66766d;">Subject</td><td style="padding:6px 10px;">${escapeHtml(inquiry.subject || TYPE_LABELS[inquiry.inquiry_type])}</td></tr>${metadata}</table><h2 style="font-size:16px;color:#173f2c;">Message</h2><p style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(inquiry.message || "No additional message.")}</p><p style="font-size:12px;color:#66766d;">Request ${escapeHtml(inquiry.request_id)} \xB7 Reply directly to reach the customer.</p></body></html>`;
}
async function sendEmail(payload, idempotencyKey) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey.slice(0, 256)
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(`resend_${response.status}:${singleLine(data?.message || data?.error, 300)}`);
  return singleLine(data?.id, 180);
}
async function logDelivery(base44, payload) {
  try {
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
  } catch (error) {
    console.warn(`[submitCustomerInquiry] delivery log failed: ${errorMessage(error)}`);
  }
}
async function handler22(req) {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (!RESEND_API_KEY) return Response.json({ error: "communications_not_configured" }, { status: 503 });
  const base44 = createClientFromRequest22(req);
  const body = await req.json().catch(() => ({}));
  const inquiryType = singleLine(body?.inquiry_type, 40);
  const requestId = singleLine(body?.request_id, 160);
  const customerEmail = email2(body?.customer_email);
  if (!Object.prototype.hasOwnProperty.call(TYPE_LABELS, inquiryType)) {
    return Response.json({ error: "unsupported_inquiry_type" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9:_-]{12,160}$/.test(requestId)) return Response.json({ error: "invalid_request_id" }, { status: 400 });
  if (!validEmail(customerEmail)) return Response.json({ error: "invalid_customer_email" }, { status: 400 });
  const prior = await base44.asServiceRole.entities.CustomerInquiry.filter({ request_id: requestId }, "-created_date", 3);
  const priorInquiry = prior[0];
  if (priorInquiry?.status === "acknowledged") {
    return Response.json({ success: true, duplicate: true, request_id: requestId, acknowledged: true });
  }
  const recent = await base44.asServiceRole.entities.CustomerInquiry.filter({ customer_email: customerEmail }, "-created_date", 10);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1e3;
  if (!priorInquiry && recent.filter((row) => new Date(row?.created_date || 0).getTime() >= dayAgo).length >= 5) {
    return Response.json({ error: "inquiry_rate_limited" }, { status: 429 });
  }
  const inquiry = {
    request_id: requestId,
    inquiry_type: inquiryType,
    customer_name: singleLine(body?.customer_name, 180),
    customer_email: customerEmail,
    customer_phone: singleLine(body?.customer_phone, 80),
    subject: singleLine(body?.subject, 240) || TYPE_LABELS[inquiryType],
    message: multiLine(body?.message, 4e3),
    source: singleLine(body?.source, 120) || "customer_app",
    status: "new",
    metadata: safeMetadata(body?.metadata)
  };
  const retryWindow = Date.now() - 15 * 60 * 1e3;
  const repeated = !priorInquiry && recent.find((row) => row?.inquiry_type === inquiryType && singleLine(row?.subject, 240) === inquiry.subject && multiLine(row?.message, 4e3) === inquiry.message && new Date(row?.created_date || 0).getTime() >= retryWindow);
  if (repeated?.status === "acknowledged") {
    return Response.json({
      success: true,
      duplicate: true,
      request_id: repeated.request_id || requestId,
      acknowledged: true
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
        tags: [{ name: "category", value: "internal_inquiry" }, { name: "inquiry_type", value: inquiryType }]
      }, internalKey),
      sendEmail({
        from: ["merch_waitlist", "delivery_waitlist"].includes(inquiryType) ? MARKETING_FROM : SUPPORT_FROM,
        to: [customerEmail],
        reply_to: SUPPORT_EMAIL,
        subject: acknowledgmentCopy(inquiryType, inquiry.customer_name).subject,
        html: customerEmailHtml(inquiryType, inquiry.customer_name),
        tags: [{ name: "category", value: "customer_inquiry" }, { name: "inquiry_type", value: inquiryType }]
      }, acknowledgmentKey)
    ]);
    const sentAt = (/* @__PURE__ */ new Date()).toISOString();
    await Promise.all([
      logDelivery(base44, { idempotency_key: internalKey, channel: "email", message_type: "internal_operations", customer_email: SUPPORT_EMAIL, provider: "resend", provider_message_id: internalMessageId, status: "sent", sent_at: sentAt, metadata: { inquiry_id: created.id, inquiry_type: inquiryType, direction: "internal" } }),
      logDelivery(base44, { idempotency_key: acknowledgmentKey, channel: "email", message_type: "customer_inquiry", customer_email: customerEmail, provider: "resend", provider_message_id: acknowledgmentMessageId, status: "sent", sent_at: sentAt, metadata: { inquiry_id: created.id, inquiry_type: inquiryType, direction: "customer_acknowledgment" } }),
      base44.asServiceRole.entities.CustomerInquiry.update(created.id, { status: "acknowledged", internal_message_id: internalMessageId, acknowledgment_message_id: acknowledgmentMessageId, acknowledged_at: sentAt, last_error: null })
    ]);
    return Response.json({ success: true, request_id: effectiveRequestId, acknowledged: true });
  } catch (error) {
    const message = errorMessage(error);
    await base44.asServiceRole.entities.CustomerInquiry.update(created.id, { last_error: message }).catch(() => {
    });
    return Response.json({ error: "inquiry_delivery_failed", request_id: effectiveRequestId }, { status: 502 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/manageDeliveryLiveActivity/entry.ts
import { createClientFromRequest as createClientFromRequest23 } from "npm:@base44/sdk@0.8.25";
var IOS_BUNDLE_ID = "com.base69d48d0c39891f7945481152.app";
var ANDROID_APP_ID = "com.nuvirajuice.app";
var ACTIONS = /* @__PURE__ */ new Set(["register_capability", "register_activity", "end_activity", "status"]);
function normalizeSingleLine4(value, maxLength = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}
function normalizeEmail10(value) {
  return normalizeSingleLine4(value, 160).toLowerCase();
}
function normalizeIdentifier(value, field, { required = true } = {}) {
  const text = normalizeSingleLine4(value, 180);
  if (!text && !required) return "";
  if (!text || !/^[A-Za-z0-9._:@/-]+$/.test(text)) throw new Error(`${field} is invalid`);
  return text;
}
function normalizePlatform(value) {
  const platform = normalizeSingleLine4(value, 20).toLowerCase();
  if (platform !== "ios" && platform !== "android") throw new Error("platform must be ios or android");
  return platform;
}
function normalizeToken(value, field, { required = false } = {}) {
  const token = normalizeSingleLine4(value, 4096).toLowerCase();
  if (!token && !required) return "";
  if (!/^[a-f0-9]+$/.test(token) || token.length < 32 || token.length > 4096 || token.length % 2 !== 0) {
    throw new Error(`${field} is invalid`);
  }
  return token;
}
function normalizeEnvironment(value) {
  const environment = normalizeSingleLine4(value, 20).toLowerCase();
  return environment === "sandbox" || environment === "production" ? environment : "unknown";
}
async function readJsonBody9(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
async function findOwnedOrder(base44, orderId, customerEmail) {
  const rows = await base44.asServiceRole.entities.Order.filter({ id: orderId }, void 0, 1);
  const order = rows[0] || null;
  return order && normalizeEmail10(order.customer_email) === customerEmail ? order : null;
}
async function upsertRegistration(base44, filters, payload) {
  const rows = await base44.asServiceRole.entities.DeliveryLiveActivity.filter(filters, "-updated_date", 5);
  const current = rows.find((row) => row.state !== "revoked") || rows[0];
  return current ? await base44.asServiceRole.entities.DeliveryLiveActivity.update(current.id, payload) : await base44.asServiceRole.entities.DeliveryLiveActivity.create(payload);
}
function safeRegistrationSummary(record) {
  return {
    registration_id: record.id || null,
    scope: record.scope,
    platform: record.platform,
    state: record.state,
    order_id: record.order_id || null,
    order_number: record.order_number || null,
    remote_start_ready: Boolean(record.push_to_start_token),
    remote_update_ready: record.platform === "android" || Boolean(record.activity_push_token),
    last_updated_at: record.last_updated_at || null
  };
}
async function handler23(req) {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const base44 = createClientFromRequest23(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) return Response.json({ error: "authentication_required" }, { status: 401 });
    const customerEmail = normalizeEmail10(user.email);
    const body = await readJsonBody9(req);
    if (!body) return Response.json({ error: "malformed_json" }, { status: 400 });
    const action = normalizeSingleLine4(body.action, 40).toLowerCase();
    if (!ACTIONS.has(action)) return Response.json({ error: "unsupported_live_activity_action" }, { status: 400 });
    if (action === "status") {
      const rows2 = await base44.asServiceRole.entities.DeliveryLiveActivity.filter({ customer_email: customerEmail }, "-updated_date", 50);
      const active = rows2.filter((row) => row.enabled !== false && row.state !== "revoked");
      return Response.json({
        success: true,
        supported_schema_version: 1,
        registrations: active.map(safeRegistrationSummary)
      });
    }
    const platform = normalizePlatform(body.platform);
    const installationId = normalizeIdentifier(body.installation_id, "installation_id");
    const bundleId = platform === "ios" ? IOS_BUNDLE_ID : ANDROID_APP_ID;
    const suppliedBundleId = normalizeSingleLine4(body.app_bundle_id, 180);
    if (suppliedBundleId && suppliedBundleId !== bundleId) {
      return Response.json({ error: "app_bundle_id_not_allowed" }, { status: 400 });
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (action === "register_capability") {
      const pushToStartToken = platform === "ios" ? normalizeToken(body.push_to_start_token, "push_to_start_token") : "";
      const record = await upsertRegistration(base44, {
        customer_email: customerEmail,
        scope: "installation",
        platform,
        installation_id: installationId
      }, {
        customer_email: customerEmail,
        scope: "installation",
        platform,
        installation_id: installationId,
        push_to_start_token: pushToStartToken || null,
        activity_push_token: null,
        apns_environment: platform === "ios" ? normalizeEnvironment(body.apns_environment) : "unknown",
        app_bundle_id: bundleId,
        app_version: normalizeSingleLine4(body.app_version, 80) || null,
        build_number: normalizeSingleLine4(body.build_number, 40) || null,
        state: "registered",
        enabled: body.enabled !== false,
        last_updated_at: now,
        ended_at: null,
        revoked_at: null
      });
      return Response.json({ success: true, registration: safeRegistrationSummary(record) });
    }
    const orderId = normalizeIdentifier(body.order_id, "order_id");
    const order = await findOwnedOrder(base44, orderId, customerEmail);
    if (!order) return Response.json({ error: "order_not_found" }, { status: 404 });
    if (action === "register_activity") {
      const activityId2 = normalizeIdentifier(body.activity_id, "activity_id");
      const activityPushToken = platform === "ios" ? normalizeToken(body.activity_push_token, "activity_push_token") : "";
      const delivered = normalizeSingleLine4(order.status, 40).toLowerCase() === "delivered";
      const record = await upsertRegistration(base44, {
        customer_email: customerEmail,
        scope: "activity",
        platform,
        installation_id: installationId,
        order_id: orderId
      }, {
        customer_email: customerEmail,
        scope: "activity",
        platform,
        installation_id: installationId,
        order_id: orderId,
        order_number: normalizeSingleLine4(order.order_number, 80) || null,
        activity_id: activityId2,
        activity_push_token: activityPushToken || null,
        apns_environment: platform === "ios" ? normalizeEnvironment(body.apns_environment) : "unknown",
        app_bundle_id: bundleId,
        app_version: normalizeSingleLine4(body.app_version, 80) || null,
        build_number: normalizeSingleLine4(body.build_number, 40) || null,
        state: "active",
        enabled: true,
        started_at: now,
        last_updated_at: now,
        ended_at: null,
        revoked_at: null
      });
      if (delivered && platform === "ios" && activityPushToken) {
        await base44.asServiceRole.functions.invoke("sendCustomerPushNotification", {
          operation: "refresh_delivery_live_activity",
          order_id: orderId,
          refresh_route: false,
          source: "late_activity_token_registration"
        }).catch(() => null);
      }
      return Response.json({ success: true, registration: safeRegistrationSummary(record) });
    }
    const activityId = normalizeIdentifier(body.activity_id, "activity_id", { required: false });
    const rows = await base44.asServiceRole.entities.DeliveryLiveActivity.filter({
      customer_email: customerEmail,
      scope: "activity",
      platform,
      installation_id: installationId,
      order_id: orderId
    }, "-updated_date", 20);
    const matches = rows.filter((row) => !activityId || row.activity_id === activityId);
    for (const row of matches) {
      await base44.asServiceRole.entities.DeliveryLiveActivity.update(row.id, {
        state: "ended",
        enabled: false,
        ended_at: now,
        last_updated_at: now
      });
    }
    return Response.json({ success: true, ended: matches.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to manage delivery live activity";
    const clientError = /invalid|must be|required|not allowed/i.test(message);
    console.warn(`[manageDeliveryLiveActivity] ${clientError ? "invalid_request" : "operation_failed"}`);
    return Response.json({ error: clientError ? message : "delivery_live_activity_unavailable" }, { status: clientError ? 400 : 500 });
  }
}

// base44/functions/getCustomerAccountDashboardData/handlers/trackMetaFunnelEvent/entry.ts
import { createClientFromRequest as createClientFromRequest24 } from "npm:@base44/sdk@0.8.25";

// base44/shared/metaIdentity.js
var META_PIXEL_ID = "719023677458304";
var META_GRAPH_API_VERSION = "v26.0";
var META_EVENTS_ENDPOINT = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_PIXEL_ID}/events`;
function normalizeEmail11(value) {
  const email3 = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email3) ? email3 : "";
}
function normalizeUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return "";
}
function normalizeHashText(value, maxLength = 120) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, maxLength);
}
function normalizeNameForHash(value) {
  return normalizeHashText(value, 80);
}
function normalizeCityForHash(value) {
  return normalizeHashText(value, 80);
}
function normalizeStateForHash(value) {
  const normalized = normalizeHashText(value, 20);
  return normalized.length === 2 ? normalized : "";
}
function normalizePostalForHash(value) {
  const raw = String(value || "").trim().toLowerCase();
  const usZip = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (usZip) return usZip[1];
  return raw.replace(/[^a-z0-9]/g, "").slice(0, 20);
}
function normalizeCountryForHash(value) {
  const normalized = normalizeHashText(value || "US", 30);
  if (!normalized || normalized === "usa" || normalized === "unitedstates") return "us";
  return normalized.length === 2 ? normalized : "";
}
var META_BROWSER_ID_PATTERN = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9._-]{1,220}$/;
function safeMetaText(value, maxLength = 500) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}
function normalizeMetaBrowserId(value) {
  const normalized = safeMetaText(value, 260);
  return META_BROWSER_ID_PATTERN.test(normalized) ? normalized : "";
}
function normalizeClientIpAddress(value) {
  const normalized = safeMetaText(value, 60).replace(/^\[|\]$/g, "");
  return /^[0-9a-fA-F:.]{3,45}$/.test(normalized) ? normalized : "";
}
function normalizeMetaEventSourceUrl(value) {
  const fallback = "https://nuvirajuice.com/checkout";
  const raw = safeMetaText(value, 500);
  if (!raw) return fallback;
  try {
    const url = new URL(raw, fallback);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !["nuvirajuice.com", "www.nuvirajuice.com"].includes(host)) {
      return fallback;
    }
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 500);
  } catch {
    return fallback;
  }
}
function firstNonEmpty(...values) {
  return values.find((value) => String(value || "").trim()) || "";
}
function splitHumanName(value) {
  const parts = String(value || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length < 2 || String(value || "").includes("@")) return {};
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
async function sha256Hex2(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function addHashedUserData(userData, key, value) {
  const normalized = String(value || "").trim();
  if (!normalized) return;
  userData[key] = [await sha256Hex2(normalized)];
}
function resolveMetaAttributionContext(checkoutData = {}) {
  const nested = checkoutData?.meta_capi_context && typeof checkoutData.meta_capi_context === "object" ? checkoutData.meta_capi_context : {};
  return {
    fbp: normalizeMetaBrowserId(firstNonEmpty(nested.fbp, checkoutData.fbp)),
    fbc: normalizeMetaBrowserId(firstNonEmpty(nested.fbc, checkoutData.fbc)),
    client_ip_address: normalizeClientIpAddress(firstNonEmpty(nested.client_ip_address, checkoutData.client_ip_address)),
    client_user_agent: safeMetaText(firstNonEmpty(nested.client_user_agent, checkoutData.client_user_agent), 500),
    event_source_url: normalizeMetaEventSourceUrl(firstNonEmpty(nested.event_source_url, checkoutData.event_source_url))
  };
}
async function buildMetaUserData({ order = {}, metadata = {}, checkoutData = {} }) {
  const nameParts = splitHumanName(firstNonEmpty(
    order.customer_name,
    checkoutData.customer_name,
    metadata.customer_name
  ));
  const email3 = normalizeEmail11(firstNonEmpty(order.customer_email, checkoutData.customer_email, metadata.customer_email));
  const phone = normalizeUsPhone(firstNonEmpty(order.contact_phone, checkoutData.contact_phone, metadata.customer_phone));
  const firstName = normalizeNameForHash(firstNonEmpty(
    checkoutData.customer_first_name,
    metadata.customer_first_name,
    nameParts.firstName
  ));
  const lastName = normalizeNameForHash(firstNonEmpty(
    checkoutData.customer_last_name,
    metadata.customer_last_name,
    nameParts.lastName
  ));
  const city = normalizeCityForHash(firstNonEmpty(order.address_city, checkoutData.address_city, metadata.delivery_city));
  const state = normalizeStateForHash(firstNonEmpty(order.address_state, checkoutData.address_state, metadata.delivery_state));
  const postalCode = normalizePostalForHash(firstNonEmpty(
    order.address_postal_code,
    checkoutData.address_postal_code,
    metadata.delivery_postal_code
  ));
  const country = normalizeCountryForHash(firstNonEmpty(order.address_country, checkoutData.address_country, "US"));
  const externalId = normalizeHashText(firstNonEmpty(
    order.customer_app_user_id,
    order.user_id,
    checkoutData.customer_app_user_id,
    checkoutData.user_id,
    checkoutData.customer_id,
    email3
  ), 180);
  const attribution = resolveMetaAttributionContext(checkoutData);
  const userData = {};
  await addHashedUserData(userData, "em", email3);
  await addHashedUserData(userData, "ph", phone);
  await addHashedUserData(userData, "fn", firstName);
  await addHashedUserData(userData, "ln", lastName);
  await addHashedUserData(userData, "ct", city);
  await addHashedUserData(userData, "st", state);
  await addHashedUserData(userData, "zp", postalCode);
  await addHashedUserData(userData, "country", country);
  await addHashedUserData(userData, "external_id", externalId);
  if (attribution.fbp) userData.fbp = attribution.fbp;
  if (attribution.fbc) userData.fbc = attribution.fbc;
  if (attribution.client_ip_address) userData.client_ip_address = attribution.client_ip_address;
  if (attribution.client_user_agent) userData.client_user_agent = attribution.client_user_agent;
  return { userData, eventSourceUrl: attribution.event_source_url };
}
var META_CONVERSIONS_CONTRACT = Object.freeze({
  pixel_id: META_PIXEL_ID,
  graph_api_version: META_GRAPH_API_VERSION,
  endpoint: META_EVENTS_ENDPOINT
});

// base44/functions/getCustomerAccountDashboardData/handlers/trackMetaFunnelEvent/handler.js
var EVENTS = /* @__PURE__ */ new Set(["ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo"]);
var ORIGINS = /* @__PURE__ */ new Set(["https://nuvirajuice.com", "https://www.nuvirajuice.com"]);
var EVENT_TTL_MS = 10 * 60 * 1e3;
var MAX_BODY_BYTES = 16384;
var MAX_CACHE_ENTRIES = 2e3;
function validSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!ORIGINS.has(url.origin) || url.username || url.password) return "";
    if (!/^\/(?:shop(?:\/[^/]+)?|products\/[^/]+|program\/[^/]+|cart|checkout)?\/?$/i.test(url.pathname)) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
function requestIp(req) {
  for (const header of ["cf-connecting-ip", "true-client-ip", "x-real-ip", "x-forwarded-for"]) {
    const value = String(req.headers.get(header) || "").split(",")[0].trim();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255)) return value;
    if (/^[a-f0-9:]{3,45}$/i.test(value) && value.includes(":")) return value;
  }
  return "";
}
function customData(input) {
  if (!input || input.currency !== "USD" || input.content_type !== "product") return null;
  if (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value < 0 || input.value > 1e5) return null;
  const result = { currency: "USD", content_type: "product", value: Math.round(input.value * 100) / 100 };
  if (input.contents !== void 0) {
    if (!Array.isArray(input.contents) || !input.contents.length || input.contents.length > 100) return null;
    const contents = [];
    for (const item of input.contents) {
      if (!/^\d{10,20}$/.test(item?.id) || !Number.isInteger(item?.quantity) || item.quantity < 1 || item.quantity > 1e3) return null;
      if (typeof item.item_price !== "number" || !Number.isFinite(item.item_price) || item.item_price < 0 || item.item_price > 1e5) return null;
      contents.push({ id: String(item.id), quantity: item.quantity, item_price: Math.round(item.item_price * 100) / 100 });
    }
    result.contents = contents;
    result.content_ids = contents.map((item) => item.id);
    result.num_items = contents.reduce((sum, item) => sum + item.quantity, 0);
  } else if (Number.isInteger(input.num_items) && input.num_items > 0 && input.num_items <= 1e3) {
    result.num_items = input.num_items;
  }
  return result;
}
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
function createMetaFunnelHandler({ env, getUser = async (_req) => null, fetchImpl = fetch, now = Date.now, log = console.info }) {
  const recent = /* @__PURE__ */ new Map();
  const rates = /* @__PURE__ */ new Map();
  const inFlight = /* @__PURE__ */ new Map();
  const prune = (map, cutoff) => {
    for (const [key, value] of map) if (value.time < cutoff) map.delete(key);
    while (map.size >= MAX_CACHE_ENTRIES) map.delete(map.keys().next().value);
  };
  const limited = (key, max, time) => {
    const bucket = rates.get(key);
    if (bucket && time - bucket.time < 6e4) {
      bucket.count += 1;
      return bucket.count > max;
    }
    rates.set(key, { time, count: 1 });
    return false;
  };
  return async function handler24(req) {
    if (req.method !== "POST") return json({ sent: false, reason: "method_not_allowed" }, 405);
    if (!ORIGINS.has(req.headers.get("origin"))) return json({ sent: false, reason: "origin_not_allowed" }, 403);
    const mode = String(env.get("META_CAPI_FUNNEL_MODE") || "").trim();
    if (!["test", "live"].includes(mode)) return json({ sent: false, reason: "funnel_disabled" });
    const token = String(env.get("META_CONVERSIONS_API_TOKEN") || "").trim();
    const testCode = String(env.get("META_CONVERSIONS_API_TEST_EVENT_CODE") || "").trim();
    if (!token || mode === "test" && !testCode) return json({ sent: false, reason: "funnel_not_configured" });
    if (!req.headers.get("content-type")?.includes("application/json")) return json({ sent: false, reason: "invalid_content_type" }, 415);
    if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return json({ sent: false, reason: "payload_too_large" }, 413);
    let body;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ sent: false, reason: "payload_too_large" }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ sent: false, reason: "invalid_json" }, 400);
    }
    if (body?.marketing_measurement_consent !== "granted") return json({ sent: false, reason: "marketing_consent_not_granted" });
    const eventName = body.event_name;
    const eventId = body.event_id;
    const time = now();
    const eventTime = body.event_time;
    const sourceUrl = validSourceUrl(body.attribution?.event_source_url);
    const data = customData(body.custom_data);
    if (!EVENTS.has(eventName) || typeof eventId !== "string" || !new RegExp(`^web:${eventName}:[A-Za-z0-9-]{12,80}$`).test(eventId) || !Number.isInteger(eventTime) || eventTime * 1e3 < time - EVENT_TTL_MS || eventTime * 1e3 > time + 6e4 || !sourceUrl || !data) return json({ sent: false, reason: "invalid_event" }, 400);
    prune(recent, time - EVENT_TTL_MS);
    prune(rates, time - 6e4);
    const key = `${mode}:${eventId}`;
    if (recent.has(key)) return json({ sent: true, deduplicated: true, event_id: eventId });
    if (inFlight.has(key)) return json(await inFlight.get(key));
    const ip = requestIp(req);
    if (limited("all", 600, time) || limited(`ip:${ip || "unknown"}`, 60, time)) {
      return json({ sent: false, reason: "rate_limited" }, 429);
    }
    const send = async () => {
      let user = null;
      let userTimer;
      try {
        user = await Promise.race([
          Promise.resolve().then(() => getUser(req)).catch(() => null),
          new Promise((resolve) => {
            userTimer = setTimeout(() => resolve(null), 750);
          })
        ]);
      } finally {
        clearTimeout(userTimer);
      }
      const { userData } = await buildMetaUserData({
        order: { user_id: user?.id, customer_email: user?.email, customer_name: user?.full_name },
        checkoutData: {
          meta_capi_context: {
            fbp: body.attribution?.fbp,
            fbc: body.attribution?.fbc,
            client_ip_address: ip,
            client_user_agent: req.headers.get("user-agent") || "",
            event_source_url: sourceUrl
          }
        }
      });
      delete userData.country;
      if (!userData.em && !userData.external_id && !userData.fbp && !userData.fbc && !(userData.client_ip_address && userData.client_user_agent)) {
        return { sent: false, reason: "matching_data_unavailable" };
      }
      const payload = {
        data: [{
          event_name: eventName,
          event_id: eventId,
          event_time: eventTime,
          action_source: "website",
          event_source_url: sourceUrl,
          user_data: userData,
          custom_data: data
        }],
        ...mode === "test" ? { test_event_code: testCode } : {}
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4e3);
      try {
        const response = await fetchImpl(META_CONVERSIONS_CONTRACT.endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const result = await response.json().catch(() => ({}));
        const sent = response.ok && Number(result.events_received) >= 1;
        if (sent) recent.set(key, { time: now() });
        const outcome = { sent, event_id: eventId, event_name: eventName, mode, reason: sent ? "accepted" : "provider_rejected" };
        log("[Meta funnel]", JSON.stringify(outcome));
        return outcome;
      } catch {
        log("[Meta funnel]", JSON.stringify({ sent: false, event_id: eventId, event_name: eventName, mode, reason: "transport_failed" }));
        return { sent: false, reason: "transport_failed" };
      } finally {
        clearTimeout(timer);
      }
    };
    const pending = send().catch(() => ({ sent: false, reason: "funnel_unavailable" }));
    inFlight.set(key, pending);
    try {
      return json(await pending);
    } finally {
      inFlight.delete(key);
    }
  };
}

// base44/functions/getCustomerAccountDashboardData/handlers/trackMetaFunnelEvent/entry.ts
var entry_default = createMetaFunnelHandler({
  env: Deno.env,
  getUser: async (req) => {
    if (!req.headers.get("authorization")) return null;
    return createClientFromRequest24(req).auth.me().catch(() => null);
  }
});

// base44/functions/getCustomerAccountDashboardData/entry.ts
var HANDLERS = {
  "addressSuggest": handler,
  "cancelSubscriptionFutureRenewal": handler2,
  "claimReward": handler3,
  "completeAccountSetup": handler4,
  "createZone3AuthorizationIntent": handler5,
  "getCustomerAccountDashboardData": handler6,
  "getCustomerNotifications": handler7,
  "getCustomerOrderDetail": handler8,
  "getDeliveryEta": handler9,
  "getOrderBySession": handler10,
  "pauseSubscription": handler11,
  "registerPushSubscription": handler12,
  "requestAccountDeletion": handler13,
  "resolveShopifyCartPermalink": handler14,
  "stripeCustomerPortal": handler15,
  "syncUserToHub": handler16,
  "unregisterPushSubscription": handler17,
  "validateDeliveryEligibility": handler18,
  "createZone3SubscriptionReviewRequest": handler19,
  "createSubscriptionPaymentElementIntent": handler20,
  "manageProgramJourney": handler21,
  "submitCustomerInquiry": handler22,
  "manageDeliveryLiveActivity": handler23,
  "trackMetaFunnelEvent": entry_default
};
var DEFAULT_ACTION = "getCustomerAccountDashboardData";
Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const rawBody = await req.text();
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const requestedAction = typeof body.gateway_action === "string" ? body.gateway_action : DEFAULT_ACTION;
  console.log(
    `[customerGateway] route=${requestedAction} explicit_action=${typeof body.gateway_action === "string"} has_payload=${Boolean(body.payload && typeof body.payload === "object")}`
  );
  const handler24 = HANDLERS[requestedAction];
  if (!handler24) return Response.json({ error: "unsupported_customer_operation" }, { status: 400 });
  const payload = body.gateway_action ? body.payload ?? {} : body;
  const forwarded = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(payload)
  });
  const response = await handler24(forwarded);
  return response instanceof Response ? response : Response.json({ error: "customer_operation_returned_no_response" }, { status: 500 });
});
