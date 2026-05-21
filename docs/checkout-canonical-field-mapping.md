# NuVira Checkout Canonical Field Mapping

Status: Gate B contract, documentation only.

Source document: `docs/checkout-scheduling-contract.md`

This document maps current Customer App checkout, scheduling, payment, loyalty, delivery, and recovery write paths into the unified canonical backend fields. It is a specification for future staging work only. It does not authorize app code changes, schema changes, Stripe changes, Hub changes, automation changes, production behavior changes, or record migration.

## Mapping Rules

- Backend-owned values must not trust frontend display state as the source of truth.
- Schedule fields must come from the backend schedule engine.
- Payment truth must come from Stripe webhook events and verified Stripe API reads.
- Admin decisions must be explicitly audited.
- Transition aliases may be preserved for compatibility, but canonical fields must be written consistently.
- Deprecated fields may remain readable until all customer, operations, and migration paths are updated.

## Legend

| Column | Meaning |
| --- | --- |
| Current CA field | Existing Customer App field, object path, or logical source. |
| Canonical field | Unified platform field to write or expose. |
| Type / req | Data type and required status. |
| Owner | Source of truth: frontend, backend, backend schedule engine, Stripe webhook, admin, or derived. |
| Timing | When the field is written or finalized. |
| Validation | Required validation before write. |
| Risk | Migration risk if mapped incorrectly. |
| Notes | Transition guidance. |

## 1. Order

Canonical entity: `Order`

Current local schema status:

- Existing CA schema is `entities/Order.jsonc`.
- Existing schema uses legacy `items`, `status`, `contact_phone`, and string `delivery_address`.
- Existing schema already contains some schedule, payment, and health advisory fields.
- Canonical fields still need schema confirmation before implementation.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `order_number` | `order_number` | string, required | backend | Order create | Unique and immutable | High | Used by confirmation, support, Hub, and customer views. |
| `customer_email`, auth user email | `customer_email` | string email, required | backend | Checkout start and Order create | Must match authenticated user or admin/system write path | High | Use lowercase normalized email for lookup/dedupe. |
| `customer_name`, profile name, user name | `customer_name` | string, required for delivery | backend | Checkout start | Required unless admin/system exception exists | Medium | Build from profile first/last only as fallback. |
| `contact_phone`, profile `phone` | `customer_phone` | string, required for delivery | backend | Checkout start | E.164 preferred; non-empty required for delivery | High | Preserve `contact_phone` as transition alias. |
| cart `items`, Order `items` | `line_items` | array<object>, required | backend | Checkout start | Product IDs, quantities, prices, and totals must be backend-validated | High | Preserve `items` alias until all CA reads migrate. |
| `subtotal` | `subtotal` | number, required | backend | Checkout start | Recalculate from validated line items | High | Frontend subtotal is display-only. |
| `tax` or absent | `tax` | number, optional/default 0 | backend | Checkout start | Calculate from tax policy if enabled | Medium | Do not infer tax from frontend if tax is introduced. |
| `discount`, reward/referral/points total | `discount` | number, optional/default 0 | backend | Checkout start | Must equal validated points, rewards, credits, and referral discounts | High | Store total discount and component discounts. |
| `total` | `total` | number, required | backend | Checkout start | Must equal subtotal + tax + delivery_fee - discounts | High | Stripe amount must match validated backend total. |
| `delivery_fee` | `delivery_fee` | number, required for delivery | backend | Delivery eligibility / checkout | Must come from backend zone result | High | Frontend display may not override. |
| `status` | `order_status` | enum string, required | backend / Stripe webhook / admin | Pending at create, finalized by webhook/admin | Must be valid lifecycle enum | High | Preserve `status` alias during transition. |
| `payment_status` | `payment_status` | enum string, required | Stripe webhook | Payment event | Must reflect verified Stripe state | High | Examples: `pending`, `paid`, `refunded`, `failed`. |
| `payment_captured` | `payment_captured` | boolean, required | Stripe webhook / admin route review | Capture event | True only after confirmed capture | High | Route review authorizations are not captured until approval. |
| `financial_status` | `financial_status` | enum string, required | Stripe webhook | Payment event | Must match Stripe/refund state | High | Keep in sync with payment/refund handling. |
| `fulfillment_type` | `fulfillment_type` | enum, required | backend | Checkout start | Must be supported for customer/address/zone | Medium | Current checkout is delivery-only. |
| `source_type` or absent | `source_type` | enum/string, required | backend | Order create | Controlled source enum | Medium | Examples: `one_time_order`, `subscription_fulfillment`, `route_review`. |
| `source_channel` or absent | `source_channel` | enum/string, required | backend | Order create | Controlled source channel | Medium | Examples: `customer_app`, `platform_admin`, `webhook`, `migration`. |
| string `delivery_address`, flat `address_*` | `delivery_address` | object, required for delivery | backend | Checkout start | Must include line1, city, state, postal_code, country | High | Preserve flat fields as aliases during transition. |
| `zone_key`, current `delivery_zone_id` misuse | `delivery_zone_key` | string, required for delivery | backend | Delivery eligibility | Must match backend zone result | High | Do not store zone key in `delivery_zone_id`. |
| entity ID or absent | `delivery_zone_id` | string ID, optional until zone entity enforced | backend | Delivery eligibility | Must reference DeliveryZone entity when present | High | Separate from `delivery_zone_key`. |
| `production_date`, `assigned_production_day` | `assigned_production_day` | date string, required after scheduling | backend schedule engine | Schedule assignment | Must be Tuesday or Friday per cadence | High | Gate B keeps canonical name but Gate C must resolve date-vs-day naming. |
| `assigned_delivery_date`, `estimated_delivery_date` | `assigned_delivery_date` | date string, required after scheduling | backend schedule engine | Schedule assignment | Must be Wednesday or Saturday per cadence | High | `estimated_delivery_date` becomes transition alias only. |
| `delivery_window_label` | `delivery_window_label` | string, required after scheduling | backend schedule engine | Schedule assignment | Wednesday 5 PM - 8 PM or Saturday 12 PM - 3 PM | High | Saturday 5 PM - 8 PM is invalid. |
| `assigned_delivery_window_start` | `assigned_delivery_window_start` | ISO timestamp/string, required after scheduling | backend schedule engine | Schedule assignment | Must match assigned delivery date/window/timezone | High | Prefer ISO timestamp with America/Chicago offset. |
| `assigned_delivery_window_end` | `assigned_delivery_window_end` | ISO timestamp/string, required after scheduling | backend schedule engine | Schedule assignment | Must be after window start | High | Prefer ISO timestamp with America/Chicago offset. |
| `delivery_window_timezone` | `delivery_window_timezone` | string, required | backend schedule engine | Schedule assignment | Must be `America/Chicago` | Medium | Display timezone for delivery window. |
| `final_schedule_source` | `final_schedule_source` | string, required | backend schedule engine / admin | Schedule assignment | Controlled enum | High | Examples: `backend_schedule_engine`, `route_review_approval`, `admin_override`. |
| `scheduling_reason` | `scheduling_reason` | string, required | backend schedule engine / admin | Schedule assignment | Must explain cutoff or override reason | Medium | Required for audit and customer support. |
| `cutoff_window_label` | `cutoff_window_label` | string, required | backend schedule engine | Schedule assignment | Must match cutoff bucket | Medium | Examples: `Tuesday 2 PM cutoff`, `Friday 2 PM cutoff`. |
| `schedule_timezone` | `schedule_timezone` | string, required | backend schedule engine | Schedule assignment | Must be `America/Chicago` | Medium | Timezone used for cutoff evaluation. |
| checkout health checkbox | `health_advisory_acknowledged` | boolean, required | backend | Checkout start | Must be true before payment intent/session creation | High | Frontend checkbox alone is not sufficient. |
| health config version | `health_advisory_version` | string, required | backend | Checkout start | Must equal active backend advisory version | High | Must survive webhook and route review. |
| checkout ack timestamp | `health_advisory_acknowledged_at` | ISO timestamp, required | backend | Checkout start | Must be server timestamp or accepted verified timestamp | High | Prefer server timestamp. |
| `do_not_recover` | `do_not_recover` | boolean, required/default false | backend / automation / admin | Terminal state update | Recovery functions must respect true | High | Preserve exactly. |
| `is_abandoned_checkout` | `is_abandoned_checkout` | boolean, required/default false | backend / automation / Stripe webhook | Abandonment/failure/cancel | True only for abandoned checkout state | High | Must not be confused with normal cancellation. |
| `ready_for_driver` | `ready_for_driver` | boolean, optional/default false | operations/backend | Fulfillment readiness | True only after production readiness rules pass | Medium | Checkout must not set true. |
| `stripe_payment_intent_id` | `stripe_payment_intent_id` | string, required for PaymentIntent checkout | Stripe / backend | Payment intent creation | Must match Stripe object | High | Manual capture and normal capture both use this. |
| `stripe_checkout_session_id` | `stripe_checkout_session_id` | string, optional | Stripe / backend | Hosted checkout if used | Must match Stripe Checkout Session | Medium | Embedded checkout may not have one. |
| `stripe_subscription_id` | `stripe_subscription_id` | string, optional | Stripe webhook | Subscription order creation | Must match Stripe subscription | High | Only for subscription-related orders. |
| `subscription_id` | `subscription_id` | string, optional | backend | Subscription fulfillment order creation | Must reference canonical Subscription | High | Do not use Stripe ID as internal ID. |
| `points_used` | `points_used` | number, optional/default 0 | backend | Checkout validation and payment success | Must not exceed available balance | High | Deduct after payment success or route approval. |
| `points_discount` | `points_discount` | number, optional/default 0 | backend | Checkout validation | 100 points = $1 | High | Backend-calculated or backend-validated. |
| `credits_discount` | `credits_discount` | number, optional/default 0 | backend | Checkout validation | Must not exceed available credit balance | High | Deduct after payment success or route approval. |
| `referral_code` | `referral_code` | string, optional | backend | Checkout validation | Must be valid and not reused against policy | Medium | Frontend code is display/input only. |
| `notes` | `notes` | string, optional | frontend/admin/backend | Checkout/admin update | Sanitize length/content | Low | Customer/admin operational notes. |
| `status_history` | `status_history` | array<object>, required/default [] | backend / Stripe webhook / admin | Every status transition | Append-only event structure | High | Preserve legacy reads during transition. |
| `audit_trail` or absent | `audit_trail` | array<object>, required/default [] | backend/admin | Every sensitive transition | Append-only event structure | High | Needed for payment, route review, recovery, migration. |

## 2. CustomerProfile

Canonical entity: `CustomerProfile`

Current local schema status:

- Existing CA schema is `entities/UserProfile.jsonc`.
- A canonical `CustomerProfile` schema is not present locally.
- Existing profile fields are mostly onboarding/contact fields and do not yet cover full loyalty, order metrics, or saved address structure.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_email`, auth email | `email` | string email, required | backend/auth | Profile create/update | Must match auth identity or admin write | High | Preserve `customer_email` alias during transition. |
| `first_name` + `last_name`, user full name | `full_name` | string, required for checkout | frontend/backend | Profile create/update | Non-empty for delivery checkout | Medium | Existing first/last may remain as display aliases. |
| `phone` | `phone` | string, optional but required for delivery checkout | frontend/backend | Profile update / checkout | Validate phone format | Medium | Checkout can require phone even if profile optional. |
| `address`, checkout flat fields | `saved_addresses[]` | array<object>, optional/default [] | frontend/backend | Profile update / checkout address save | Each address requires line1/city/state/postal_code/country | High | Existing string address becomes default saved address during migration. |
| `address` | default address behavior | derived, required when saved addresses exist | backend | Profile normalization | Exactly one default preferred; fallback first address | Medium | Store `is_default` per saved address. |
| absent or checkout zone result | `delivery_zone_id` | string ID, optional | backend | Address validation/profile update | Must reference DeliveryZone when known | Medium | Pair with delivery zone key where needed. |
| Stripe customer from payment flow | `stripe_customer_id` | string, optional | Stripe/backend | Stripe customer creation | Must match Stripe customer | High | Use for subscriptions and saved payments. |
| `UserPoints.total_points` | `loyalty_points` | number, required/default 0 | backend | Points account update | Cannot be negative | High | UserPoints may remain transition storage. |
| `UserPoints.lifetime_points` | `lifetime_points` | number, required/default 0 | backend | Points earning | Monotonic except admin correction | Medium | Keep audit history. |
| `UserPoints.redeemed_points` | `redeemed_points` | number, required/default 0 | backend | Points redemption | Cannot exceed lifetime earned after policy adjustments | Medium | |
| `UserPoints.points_history` | `points_history` | array<object>, required/default [] | backend | Every points change | Append-only with order/reference IDs | High | Required for reconciliation. |
| `birthday` | `birthday` | date string, optional | frontend/backend | Profile update | Valid date; policy for year optionality required | Medium | Birthday reward logic remains gated. |
| profile wellness/diet fields | `dietary_notes` | string/array, optional | frontend/admin | Profile update | Sanitize content | Low | Map wellness fields only after profile model decision. |
| `sms_consent`, notification records | `notification_prefs` | object, required/defaults | frontend/backend | Profile update / opt-in changes | Consent timestamp required for SMS opt-in | High | Push/email/SMS prefs should not be mixed with checkout state. |
| derived Orders count | `order_count` | number, required/default 0 | derived/backend | Order finalization | Derived from paid/valid orders only | Medium | Do not trust frontend. |
| derived Orders total | `lifetime_value` | number, required/default 0 | derived/backend | Order finalization/refund | Paid less refunded/cancelled policy | Medium | Must exclude abandoned/test orders. |
| derived latest order | `last_order_date` | date/string, optional | derived/backend | Order finalization | Most recent eligible paid order | Low | |
| onboarding/source | `signup_source` | string, optional | backend/frontend | Profile create | Controlled source enum | Low | Examples: `customer_app`, `apple`, `google`, `migration`. |

## 3. DeliveryZone

Canonical entity: `DeliveryZone`

Current local schema status:

- Existing CA schema is `entities/DeliveryZone.jsonc`.
- Existing schema has `zone_key`, `zone_name`, `zone_type`, `delivery_fee`, `minimum_order`, `manual_capture_required`, `checkout_allowed`, and `allowed_for_subscriptions`.
- Canonical names should standardize `name`, `status`, `minimum_order_amount`, `max_distance_miles`, `delivery_days`, and `delivery_windows`.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zone_key` | `zone_key` | string, required | admin/backend | Zone setup | Unique stable key | High | Used by checkout and order mapping. |
| `zone_name` | `name` | string, required | admin | Zone setup | Non-empty display label | Low | Preserve `zone_name` alias. |
| `zone_type` | `zone_type` | enum, required | admin/backend | Zone setup | `core`, `extended`, `route_review`, `waitlist_only`, `unavailable` | High | Controls checkout path. |
| `is_active` | `status` | enum/string, required | admin | Zone setup/update | Controlled status, e.g. `active`, `paused`, `retired` | Medium | Replace boolean-only state. |
| `checkout_allowed` | `checkout_allowed` | boolean, required | backend/admin | Zone evaluation | Must match zone_type and minimum rules | High | Waitlist zones must false. |
| `manual_capture_required` | `manual_capture_required` | boolean, required | backend/admin | Zone evaluation | True for route review | High | Required for Stripe manual capture routing. |
| `allowed_for_subscriptions` | `allowed_for_subscriptions` | boolean, required | backend/admin | Zone evaluation | False for route_review and waitlist_only unless later approved | High | |
| `delivery_fee` | `delivery_fee` | number, required for serviceable zones | backend/admin | Zone evaluation | Non-negative | High | Backend source for checkout. |
| `minimum_order` | `minimum_order_amount` | number, optional/default 0 | backend/admin | Zone evaluation | Non-negative | High | Preserve `minimum_order` alias. |
| `max_drive_miles` | `max_distance_miles` | number, required | backend/admin | Zone evaluation | Greater than min distance | Medium | Preserve drive-specific fields if routing uses them. |
| `allowed_delivery_days` | `delivery_days` | array<string>, required | backend/admin | Zone setup | Must align with canonical Wed/Sat cadence | Medium | |
| absent / schedule config | `delivery_windows` | array<object>, required | backend/admin | Zone setup | Must align Wed 5-8, Sat 12-3 | High | Needed if zone-specific windows appear later. |
| `origin_address` | `origin_address` | string, required | backend/admin | Zone setup | Valid geocodable origin | Medium | Used for distance matrix. |
| `admin_notes`, `customer_message` | `notes` | string, optional | admin | Zone setup/update | Sanitize length/content | Low | Keep customer message separately if needed. |

## 4. DeliveryWaitlist

Canonical entity: `DeliveryWaitlist`

Current local schema status:

- Existing CA schema is `entities/DeliveryWaitlist.jsonc`.
- Existing schema has `customer_email`, `postal_code`, `customer_name`, `customer_phone`, `delivery_address`, `source`, `status`, and `admin_notes`.
- Canonical field aliases are required for `phone`, `address`, `notes`, and `created_from`.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `email`, `customer_email` | `customer_email` | string email, required | frontend/backend | Waitlist submit | Normalize lowercase; dedupe with postal_code | High | Drop `email` write path. |
| `zip`, `postal_code` | `postal_code` | string, required | frontend/backend | Waitlist submit | US ZIP format initially | High | Drop `zip` write path. |
| `customer_name` | `customer_name` | string, optional | frontend/backend | Waitlist submit | Sanitize | Low | |
| `customer_phone` | `phone` | string, optional | frontend/backend | Waitlist submit | Phone format if present | Medium | Preserve `customer_phone` alias. |
| `delivery_address` | `address` | string/object, optional | frontend/backend | Waitlist submit | Sanitize; preserve postal code separately | Medium | Preserve `delivery_address` alias. |
| `reason`, freeform | `notes` | string, optional | frontend/admin/backend | Waitlist submit/admin update | Sanitize | Low | Keep `reason` as controlled category if useful. |
| `source` | `source` | enum/string, required | frontend/backend | Waitlist submit | Controlled enum | Medium | Add `cart_delivery_check` if needed. |
| `status` | `status` | enum, required/default `new` | admin/backend | Waitlist lifecycle | Controlled enum | Medium | |
| absent | `created_from` | string, required | backend | Waitlist submit | Controlled origin: `checkout`, `cart`, `route_review_denial`, `admin` | Medium | Required for migration analysis. |
| `admin_notes` | `admin_notes` | string, optional | admin | Admin update | Sanitize | Low | |

## 5. DeliveryApprovalRequest / Route Review

Canonical entity decision:

- Existing CA entity `DeliveryApprovalRequest` should be preserved for staging unless Gate C/D identifies a strong reason to replace it.
- It needs canonical aliases and tighter route-review state definitions before unified platform migration.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_email` | `customer_email` | string email, required | backend | Route review request | Must match auth user or admin/system | High | |
| `customer_name` | `customer_name` | string, required | backend/frontend | Route review request | Non-empty preferred | Medium | |
| `customer_phone` | `phone` | string, required | backend/frontend | Route review request | Required for route review contact | High | Preserve `customer_phone` alias. |
| `delivery_address`, flat `address_*` | `address` | object/string, required | backend | Route review request | Must include postal code | High | Preserve flat fields during transition. |
| `address_postal_code` | `postal_code` | string, required | backend | Route review request | ZIP format | High | |
| `zone_key` | `delivery_zone_key` | string, required | backend | Eligibility result | Must be route_review zone | High | Preserve `zone_key` alias. |
| `cart_items` | `cart_snapshot` | object/array, required | backend | Authorization create | Must include validated line items, prices, quantities | High | Immutable snapshot. |
| `cart_subtotal` | `subtotal` | number, required | backend | Authorization create | Backend validated | High | |
| `estimated_delivery_fee`, `approved_delivery_fee` | `delivery_fee` | number, required | backend/admin | Request create/approval | Must match zone or admin-approved fee | High | |
| `estimated_total` | `total` | number, required | backend | Authorization create | Must match Stripe authorized amount | High | |
| `stripe_payment_intent_id` | `stripe_payment_intent_id` | string, required for one-time route review | Stripe/backend | Authorization create | Must be manual capture PaymentIntent | High | |
| `stripe_authorization_status` | `manual_capture_status` | enum, required | Stripe webhook/backend | Authorization/capture/cancel | Must reflect Stripe state | High | Examples: `authorized`, `captured`, `cancelled`, `expired`. |
| `status`, `admin_decision` | `approval_status` | enum, required | admin/backend | Request lifecycle | Controlled lifecycle | High | Examples: `pending_review`, `approved`, `denied`, `expired`. |
| `approved_by` | `approved_by` | string, optional | admin | Approval | Required if approved | Medium | |
| `approved_at` | `approved_at` | ISO timestamp, optional | admin/backend | Approval | Required if approved | Medium | |
| `denied_by` | `denied_by` | string, optional | admin | Denial | Required if denied | Medium | |
| `denied_at` | `denied_at` | ISO timestamp, optional | admin/backend | Denial | Required if denied | Medium | |
| `admin_decision_reason` | `denial_reason` | string, optional | admin | Denial | Required if denied | Medium | Preserve general decision reason as alias. |
| `created_order_id` | `related_order_id` | string, optional | backend/admin | Approval/order creation | Must reference created/advanced Order | High | Preserve created order fields as aliases. |
| `admin_decision_reason`, `audit_trail.note` | `notes` | string, optional | admin/backend | Any lifecycle transition | Sanitize | Low | |

## 6. CheckoutSession

Canonical entity decision:

- Existing CA entity `CheckoutSession` must be preserved during transition because webhook finalization depends on checkout snapshots.
- Existing schema is minimal and needs canonical fields for embedded PaymentIntent checkout, abandonment, terminal safety, and metadata.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `stripe_session_id`, generated session key | `session_id` | string, required | backend | Checkout session create | Unique immutable ID | High | For embedded checkout, may be internal session ID instead of Stripe Checkout Session. |
| `customer_email` | `customer_email` | string email, required | backend | Checkout session create | Match auth user or admin/system path | High | |
| `checkout_data.items` | `cart_snapshot` | object/array, required | backend | Checkout session create | Backend validated prices/quantities | High | Immutable for webhook reconciliation. |
| `checkout_data.delivery_address`, flat fields | `delivery_address` | object, required for delivery | backend | Checkout session create | Structured address validation | High | |
| `checkout_data.zone_key` | `delivery_zone_key` | string, required for delivery | backend | Checkout session create | Must match eligibility result | High | |
| `checkout_data.schedule` | `schedule_snapshot` | object, required | backend schedule engine | Checkout session create | Must include canonical schedule fields | High | Snapshot may be revalidated at webhook. |
| `stripe_payment_intent_id` in data | `payment_intent_id` | string, required for embedded checkout | Stripe/backend | PaymentIntent create | Must match Stripe PI | High | |
| client secret response only | `stripe_client_secret` | string, sensitive optional | Stripe/backend | PaymentIntent create | Must not be exposed except to owning client | High | Consider not persisting if avoidable. |
| absent | `status` | enum, required | backend / Stripe webhook / automation | Session lifecycle | Controlled enum | High | Examples: `created`, `payment_pending`, `completed`, `abandoned`, `expired`, `cancelled`. |
| `expires_at` | `expires_at` | ISO timestamp, required | backend | Session create | Future timestamp | Medium | |
| absent | `do_not_recover` | boolean, required/default false | backend / automation / admin | Terminal update | Recovery must respect true | High | |
| absent | `abandoned_at` | ISO timestamp, optional | automation/backend | Abandonment | Required when abandoned | Medium | |
| Order ID/order number | `completed_order_id` | string, optional | Stripe webhook/backend | Payment success | Must reference final Order | High | |
| `checkout_data` | `metadata` | object, optional | backend | Session create/update | Must exclude secrets; safe for audit | Medium | Preserve original checkout_data during transition. |

## 7. Subscription

Canonical entity: `Subscription`

Current local schema status:

- Existing CA schema is `entities/Subscription.jsonc`.
- Existing schema has core subscription, delivery, Stripe, and Hub sync fields.
- It lacks several canonical billing/cadence fields or uses aliases such as `next_delivery_date` and `paused_until`.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_email` | `customer_email` | string email, required | backend | Subscription create | Match auth/Stripe customer | High | |
| `plan_id` | `plan_id` | string, required | backend | Subscription create | Must reference active SubscriptionPlan | High | |
| plan lookup title/name | `plan_name` | string, required | backend | Subscription create | Snapshot active plan name | Medium | Preserve for historical display. |
| plan frequency | `cadence` | enum/string, required | backend | Subscription create | Controlled enum | High | Examples: `weekly`, `monthly`; must align fulfillment schedule. |
| `status` | `status` | enum, required | backend / Stripe webhook / admin | Lifecycle update | Must match Stripe and app policy | High | |
| `delivery_zone_id` | `delivery_zone_id` | string, required | backend | Subscription create/update | Must reference serviceable zone | High | Route review/waitlist not allowed unless later approved. |
| `delivery_address` | `delivery_address` | object, required | backend | Subscription create/update | Structured address required | High | Preserve string alias during transition. |
| `stripe_subscription_id` | `stripe_subscription_id` | string, required after Stripe create | Stripe/backend | Subscription create | Must match Stripe subscription | High | |
| `stripe_customer_id` | `stripe_customer_id` | string, required after Stripe create | Stripe/backend | Subscription create | Must match Stripe customer | High | |
| Stripe price from plan | `stripe_price_id` | string, required for Stripe subscription | backend/Stripe | Subscription create | Must match active plan price | High | Existing schema needs confirmation. |
| Stripe period start | `current_period_start` | ISO timestamp, required after active | Stripe webhook | Billing lifecycle | Must match Stripe | Medium | Existing schema needs field. |
| Stripe period end | `current_period_end` | ISO timestamp, required after active | Stripe webhook | Billing lifecycle | Must match Stripe | Medium | Existing schema needs field. |
| `next_delivery_date` | `next_fulfillment_date` | date string, required after scheduling | backend schedule engine | Subscription create/renewal | Generated by schedule engine | High | Preserve `next_delivery_date` alias. |
| `paused_until` | `pause_until` | date string, optional | admin/customer/backend | Pause action | Must be future date if active pause | Medium | Preserve `paused_until` alias. |
| `cancel_at_period_end` | `cancel_at_period_end` | boolean, required/default false | Stripe/backend/customer | Cancellation request | Must match Stripe policy | High | |
| cancellation field | `cancellation_reason` | string, optional | frontend/admin/backend | Cancellation request | Sanitize | Low | Existing schema needs confirmation. |
| fulfillment count | `total_fulfillments` | number, required/default 0 | backend | Fulfillment completion | Monotonic except admin correction | Medium | Existing schema needs field. |
| `description`, admin note | `notes` | string, optional | admin/backend | Create/update | Sanitize length/content | Low | Preserve `description` alias if needed. |

## 8. Loyalty / Points / Rewards

Canonical approach:

- Customer-facing loyalty balances should live on canonical `CustomerProfile` fields or a canonical loyalty account linked to CustomerProfile.
- Existing `UserPoints` may remain as the transition source until unified schema is approved.
- Checkout Order should store redemption snapshots: `points_used`, `points_discount`, and optional `reward_redemption_id`.
- 100 points = $1.
- Backend validation is required for every redemption.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `UserPoints.total_points` | `CustomerProfile.loyalty_points` | number, required/default 0 | backend | Points earning/redemption | Cannot go negative | High | Transition may read UserPoints and sync CustomerProfile. |
| `UserPoints.lifetime_points` | `CustomerProfile.lifetime_points` | number, required/default 0 | backend | Points earning | Must reconcile with history | Medium | |
| `UserPoints.redeemed_points` | `CustomerProfile.redeemed_points` | number, required/default 0 | backend | Redemption | Must reconcile with history | Medium | |
| `UserPoints.points_history` | `CustomerProfile.points_history` | array<object>, required/default [] | backend | Every points event | Append-only with source/order IDs | High | |
| checkout `points_used` | `Order.points_used` | number, optional/default 0 | backend | Checkout validation/payment success | Cannot exceed available points | High | Deduct after payment success or route approval. |
| checkout `points_discount` | `Order.points_discount` | number, optional/default 0 | backend | Checkout validation | 100 points = $1 | High | |
| active reward local storage / claimed reward | `reward_redemption_id` | string, optional | backend | Checkout validation/payment success | Must reference valid owned unredeemed reward | High | Add if rewards are formalized as records. |
| `reward_type` values | reward type enum | enum, required for rewards | backend/admin | Reward setup/redemption | Canonical enum required | High | Existing discount enum gap must be resolved. |

## 9. Credits

Canonical approach:

- Existing `NuViraCredit` may remain the transition account.
- Checkout Order stores `credits_discount` as the redemption snapshot.
- Backend validation is required before checkout amount finalization.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NuViraCredit.customer_email` | credit account customer link | string email, required | backend/admin | Credit account create | Match CustomerProfile email | High | |
| `NuViraCredit.balance` | credit balance | number, required/default 0 | backend/admin | Credit issue/use | Cannot go negative | High | |
| `credits_discount` | `Order.credits_discount` | number, optional/default 0 | backend | Checkout validation/payment success | Cannot exceed available balance | High | Deduct after payment success or route approval. |
| `NuViraCredit.history` | credit balance adjustments | array<object>, required/default [] | backend/admin | Every credit change | Append-only with order/source IDs | High | |
| `NuViraCredit.lifetime_issued` | lifetime issued credits | number, required/default 0 | backend/admin | Credit issue | Reconcile with history | Medium | |
| `NuViraCredit.lifetime_used` | lifetime used credits | number, required/default 0 | backend | Credit redemption | Reconcile with history | Medium | |

## 10. FulfillmentTask

Canonical entity: `FulfillmentTask`

Current local schema status:

- Existing CA schema is `entities/FulfillmentTask.jsonc`.
- Existing schema is subscription-oriented and does not fully cover checkout-created delivery task fields.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Order entity ID | `order_id` | string, required | backend | Fulfillment task create | Must reference canonical Order | High | |
| `order_number` | `order_number` | string, required | backend | Fulfillment task create | Must match Order | Medium | Existing schema needs field. |
| `customer_email` | `customer_email` | string email, required | backend | Fulfillment task create | Must match Order | Medium | |
| `fulfillment_type` | `fulfillment_type` | enum, required | backend | Fulfillment task create | Must match Order | Medium | Existing schema needs field. |
| fulfillment task `status` | `status` | enum, required/default pending | backend/ops/driver | Fulfillment lifecycle | Controlled enum | High | |
| `assigned_delivery_date`, `delivery_date` | `scheduled_date` | date string, required | backend schedule engine | Fulfillment task create | Must match Order assigned delivery date | High | Existing schema uses `delivery_date`. |
| `delivery_window_label` | `delivery_window_label` | string, required | backend schedule engine | Fulfillment task create | Must match canonical Order window | High | Existing schema needs field. |
| Order `delivery_address` | `delivery_address` | object/string, required | backend | Fulfillment task create | Must match Order address | High | Existing schema needs field. |
| generated summary | `items_summary` | string, optional | backend | Fulfillment task create/display | Derived from line items | Low | |
| `items` | `line_items` | array<object>, required | backend | Fulfillment task create | Must match Order line_items | High | Preserve `items` alias. |
| Order `payment_status` | `payment_status` | enum, required | backend/Stripe webhook | Fulfillment task create/update | Do not fulfill unpaid order | High | Existing schema needs field. |
| Order `source_type` | `source_type` | enum/string, required | backend | Fulfillment task create | Match Order source | Medium | Existing schema needs field. |

## 11. NotificationQueue

Canonical entity decision:

- A canonical `NotificationQueue` entity is required if checkout notifications are queued, suppressed, retried, or staged.
- Existing CA has `Notification`, `NotificationCampaign`, and push-notification worktree files, but no local `NotificationQueue` schema.
- During staging, notification queue writes must support suppression rules to avoid live customer sends.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Notification.type`, subtype | `notification_type` | enum/string, required | backend | Queue create | Controlled type enum | High | Examples: order confirmation, delivery reminder, payment failed. |
| `customer_email` | `recipient_email` | string email, required | backend | Queue create | Valid recipient and consent policy | High | |
| `order_id` | `related_order_id` | string, optional/required for order notifications | backend | Queue create | Must reference Order when order-related | High | |
| `is_read`, send state absent | `status` | enum, required | backend/notification worker | Queue lifecycle | Controlled enum | High | Examples: `queued`, `suppressed`, `sent`, `failed`, `cancelled`. |
| notification payload | `metadata` | object, optional | backend | Queue create/update | Must not include secrets | Medium | Include order number, channel, idempotency key. |
| staging flags absent | suppression rules | object/fields, required in staging | backend/admin | Queue create/send | Must suppress production sends in staging | High | Required before staging tests. |

## 12. PlatformEvent / Audit

Canonical entity decision:

- A canonical `PlatformEvent` or audit entity is required for checkout, payment, route review, recovery, migration, and notification pipeline auditing.
- Existing CA `Event` schema is a marketing/event listing entity, not an audit log.
- Existing point, credit, approval, and order histories are not enough to replace a platform-level audit trail.

| Current CA field | Canonical field | Type / req | Owner | Timing | Validation | Risk | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| assorted event labels | `event_type` | enum/string, required | backend/admin/system | Every audited action | Controlled event enum | High | Examples: `checkout_created`, `payment_succeeded`, `route_review_denied`. |
| entity name | `entity_type` | string, required | backend/admin/system | Every audited action | Must name canonical entity | Medium | Examples: Order, CheckoutSession, DeliveryApprovalRequest. |
| entity ID | `entity_id` | string, required | backend/admin/system | Every audited action | Must reference entity when available | Medium | |
| app/function name | `source_system` | string, required | backend/admin/system | Every audited action | Controlled source enum | Medium | Examples: `customer_app`, `platform`, `stripe_webhook`, `admin`. |
| function/pipeline name | `pipeline_name` | string, optional | backend/system | Pipeline/action run | Controlled name | Low | |
| status history action | `action` | string, required | backend/admin/system | Every audited action | Controlled action where possible | Medium | |
| result state | `status` | enum, required | backend/admin/system | Every audited action | `success`, `failed`, `skipped`, `blocked` | Medium | |
| payload fragments | `metadata` | object, optional | backend/admin/system | Every audited action | Redact secrets and payment-sensitive data | High | |
| caught error | `error_message` | string, optional | backend/system | Failed action | Sanitize; no secrets | Medium | |
| log level | `severity` | enum, required/default info | backend/system | Every audited action | Controlled enum | Low | Examples: `info`, `warning`, `error`, `critical`. |

## Fields To Drop / Deprecate

These fields or write patterns should be dropped after transition aliases are no longer needed:

- `Order.items` as the canonical order item field. Replace with `Order.line_items`.
- `Order.status` as the canonical status. Replace with `Order.order_status`.
- `Order.contact_phone` as the canonical customer phone. Replace with `Order.customer_phone`.
- String-only `Order.delivery_address` as the canonical address. Replace with structured `delivery_address`.
- Flat address fields as canonical source fields. Preserve only as aliases while legacy UI still reads them.
- `estimated_delivery_date` as a final schedule field. Replace with `assigned_delivery_date`.
- Storing a delivery zone key in `delivery_zone_id`.
- Waitlist `email` and `zip` write paths. Replace with `customer_email` and `postal_code`.
- Independent frontend checkout scheduling/cutoff calculations.
- Frontend-only health advisory acknowledgment.
- Notification sending directly from staging checkout flows without queue suppression.

## Fields To Preserve As Transition Aliases

These fields should remain readable during migration until all customer and operations views are confirmed migrated:

- `Order.items` alias of `line_items`.
- `Order.status` alias of `order_status`.
- `Order.contact_phone` alias of `customer_phone`.
- `Order.delivery_address` string display alias derived from structured address.
- `Order.address_line1`, `address_line2`, `address_city`, `address_state`, `address_postal_code`, `address_country`.
- `Order.estimated_delivery_date` alias of `assigned_delivery_date`.
- `DeliveryZone.zone_name` alias of `name`.
- `DeliveryZone.minimum_order` alias of `minimum_order_amount`.
- `DeliveryWaitlist.customer_phone` alias of `phone`.
- `DeliveryWaitlist.delivery_address` alias of `address`.
- `DeliveryApprovalRequest.zone_key` alias of `delivery_zone_key`.
- `CheckoutSession.checkout_data` as legacy metadata/snapshot until webhook paths are updated.
- `Subscription.next_delivery_date` alias of `next_fulfillment_date`.
- `Subscription.paused_until` alias of `pause_until`.
- `UserPoints` and `NuViraCredit` as transition stores until canonical customer financial/loyalty schema is approved.

## Missing Entities / Schemas

Based on local entity files, these canonical schemas are missing or incomplete:

| Entity/logical object | Local status | Required action before implementation |
| --- | --- | --- |
| `CustomerProfile` | Missing; current schema is `UserProfile` | Decide whether to create `CustomerProfile` or evolve/rename `UserProfile`. |
| `Order` canonical fields | Existing but incomplete | Add/confirm `order_status`, `line_items`, `customer_phone`, structured `delivery_address`, `delivery_zone_key`, `delivery_zone_id`, subscription refs, points/credits discounts, `audit_trail`, and abandoned flag fields. |
| `DeliveryZone` canonical fields | Existing but alias-heavy | Add/confirm `name`, `status`, `minimum_order_amount`, `max_distance_miles`, `delivery_days`, `delivery_windows`, and notes semantics. |
| `DeliveryWaitlist` canonical fields | Existing but alias-heavy | Add/confirm `phone`, `address`, `notes`, `created_from`, source enum values. |
| `DeliveryApprovalRequest` | Existing | Add/confirm canonical aliases for phone/address/postal/zone/status/manual capture/related order fields. |
| `CheckoutSession` | Existing but minimal | Add/confirm session status, cart/address/schedule snapshots, PaymentIntent fields, `do_not_recover`, `abandoned_at`, `completed_order_id`, metadata. |
| `Subscription` | Existing but incomplete | Add/confirm `plan_name`, `cadence`, `stripe_price_id`, period fields, `next_fulfillment_date`, `pause_until`, cancellation reason, fulfillment count. |
| `NotificationQueue` | Missing | Required for queued/suppressed checkout notifications in staging. |
| `PlatformEvent` / audit log | Missing; existing `Event` is not an audit entity | Required for unified platform pipeline and migration audit. |
| `FulfillmentTask` | Existing but incomplete | Add/confirm checkout-created task fields, schedule fields, line_items, payment status, source type. |

## Unresolved Blockers

- Final decision: create `CustomerProfile` or evolve `UserProfile`.
- Final decision: use `assigned_production_day` as a date field or rename/alias to `production_date`.
- Final decision: create `NotificationQueue` and `PlatformEvent` before checkout staging, or defer with explicit suppression/audit fallback.
- Final decision: canonical reward type enum and whether `reward_redemption_id` is required.
- Final decision: exact route review entity name and whether current `DeliveryApprovalRequest` becomes canonical.
- Final decision: whether CheckoutSession may persist Stripe client secrets or should store only PaymentIntent IDs and non-secret metadata.
- Gate C must verify the backend schedule function can produce all canonical schedule fields and reject stale frontend selections.

## Approval Needed Before Implementation

Before any checkout implementation, schema edit, backend function edit, Stripe test, Hub sync change, automation change, or production behavior change:

- Approve this Gate B canonical field mapping.
- Approve Gate C backend schedule function audit/update scope.
- Confirm missing schema/entity decisions.
- Confirm transition alias policy.
- Confirm staging notification suppression policy.
- Confirm health advisory active version source.
- Confirm Stripe test-mode smoke test plan.

## Next Gate

Gate C: backend scheduling function audit/update.

Gate C should verify that the backend schedule function can serve as the single schedule authority described in `docs/checkout-scheduling-contract.md` and can produce the canonical schedule fields defined here.
