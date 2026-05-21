# NuVira Checkout and Scheduling Contract

Status: Gate A contract, documentation only.

This document defines the checkout and scheduling contract for the NuVira unified platform migration. It is the source of truth for future checkout implementation work. It does not authorize code changes, schema changes, Stripe changes, Hub changes, production automation changes, or record migration.

## 1. Schedule Source of Truth

The backend schedule function is the authority for checkout scheduling.

After migration:

- The frontend must not independently calculate final production dates, delivery dates, cutoff windows, or delivery windows.
- The Checkout page must request available schedule options from the backend.
- `DeliveryDatePicker` must render backend-provided options only.
- `DeliveryDatePicker` must not calculate final schedule values.
- The selected frontend option must round-trip back to the backend for validation.
- The backend may override or reject stale, invalid, or unavailable frontend selections.
- Backend schedule output is the value persisted to the Order record and used for fulfillment, Hub sync, customer notifications, and operational reporting.

## 2. Final NuVira Cadence

Production days:

- Tuesday
- Friday

Delivery days and windows:

- Wednesday, 5 PM - 8 PM
- Saturday, 12 PM - 3 PM

Cutoff:

- 2:00 PM America/Chicago

All schedule calculations must be evaluated in `America/Chicago`.

## 3. Cutoff Logic

The cutoff rule is based on the time the backend accepts the checkout or payment event, not a client-local clock.

Tuesday production / Wednesday delivery:

- Orders placed Friday after 2:00 PM America/Chicago
- Orders placed Saturday
- Orders placed Sunday
- Orders placed Monday
- Orders placed Tuesday until 2:00 PM America/Chicago

Result:

- `production_date` = next/current Tuesday
- `delivery_date` = Wednesday
- `delivery_window` = Wednesday 5 PM - 8 PM

Friday production / Saturday delivery:

- Orders placed Tuesday after 2:00 PM America/Chicago
- Orders placed Wednesday
- Orders placed Thursday
- Orders placed Friday until 2:00 PM America/Chicago

Result:

- `production_date` = next/current Friday
- `delivery_date` = Saturday
- `delivery_window` = Saturday 12 PM - 3 PM

Boundary rule:

- Exactly 2:00:00 PM America/Chicago is treated as still before the cutoff.
- Any time after 2:00:00 PM America/Chicago is treated as after the cutoff.

## 4. Frontend Behavior

The frontend checkout flow is display and selection only for scheduling.

Required behavior:

- Checkout requests available schedule options from the backend.
- `DeliveryDatePicker` renders only the backend response.
- `DeliveryDatePicker` does not calculate final schedule values.
- The selected option ID or payload must be submitted back to the backend.
- The backend revalidates the selected option at checkout/payment time.
- If the selected option is stale, unavailable, or inconsistent with the backend schedule engine, the backend may reject checkout or return a corrected option.

Forbidden behavior after migration:

- Independent frontend cutoff calculations.
- Independent frontend next-delivery calculations.
- Hardcoded Wednesday/Saturday delivery windows in checkout UI.
- Persisting frontend-calculated schedule fields without backend validation.

## 5. Canonical Order Schedule Fields

These fields are the canonical schedule fields for checkout-created Orders.

| Field | Canonical usage |
| --- | --- |
| `assigned_production_day` | Backend-assigned production date in `YYYY-MM-DD` format. This is the operational production day used by production and fulfillment. |
| `assigned_delivery_date` | Backend-assigned delivery date in `YYYY-MM-DD` format. This is the customer delivery day and fulfillment delivery day. |
| `delivery_window_label` | Human-readable customer-facing window label, for example `Wednesday 5 PM - 8 PM` or `Saturday 12 PM - 3 PM`. |
| `assigned_delivery_window_start` | Backend-assigned delivery window start as an ISO 8601 timestamp with the correct America/Chicago offset for that date. |
| `assigned_delivery_window_end` | Backend-assigned delivery window end as an ISO 8601 timestamp with the correct America/Chicago offset for that date. |
| `delivery_window_timezone` | Display timezone for the delivery window. Default and expected value: `America/Chicago`. |
| `final_schedule_source` | Machine-readable source of the final schedule, such as `backend_schedule_engine`, `route_review_approval`, or `admin_override`. |
| `scheduling_reason` | Human-readable explanation of why the schedule was assigned, including cutoff logic where useful. |
| `cutoff_window_label` | Human-readable cutoff bucket, such as `Tuesday 2 PM cutoff` or `Friday 2 PM cutoff`. |
| `schedule_timezone` | Timezone used by the schedule engine for cutoff evaluation. Expected value: `America/Chicago`. |

Rules:

- Backend schedule fields must be written together as one consistent schedule assignment.
- Frontend-provided schedule fields are advisory until revalidated by the backend.
- Hub sync, customer notifications, driver views, production views, and order detail views must use these canonical fields.
- Legacy aliases may exist during transition, but canonical fields must not be overwritten by stale legacy values.

## 6. Delivery Zones

Delivery zone evaluation is backend-authoritative.

Required zone response fields:

| Field | Usage |
| --- | --- |
| `checkout_allowed` | Whether one-time checkout may proceed without waitlist blocking. |
| `manual_capture_required` | Whether Stripe manual capture and route review are required. |
| `allowed_for_subscriptions` | Whether subscription checkout is allowed for the zone. |
| `delivery_fee` | Backend-calculated delivery fee for the zone. |
| `minimum_order_amount` | Minimum subtotal required before checkout is allowed. |
| `delivery_zone_key` | Stable machine key for the zone, such as `zone_1a`, `zone_2`, or `zone_3a`. |
| `delivery_zone_id` | Canonical persisted entity ID if a DeliveryZone entity exists. This must not be confused with `delivery_zone_key`. |

Zone behavior:

| Zone type | Checkout | Manual capture | Subscriptions | Notes |
| --- | --- | --- | --- | --- |
| `core` | Allowed if minimums are met | No | Allowed if subscription rules are met | Normal checkout flow. |
| `extended` | Allowed if minimums are met | No | Allowed if subscription rules are met | Normal checkout flow with extended-zone fee/minimum. |
| `route_review` | Not normal immediate checkout | Yes | Not allowed unless explicitly approved later | Customer enters route review/manual authorization flow. |
| `waitlist_only` | Not allowed | No | Not allowed | Customer may submit waitlist/lead information only. |

Rules:

- The backend determines delivery fee and minimum order amount.
- The frontend may display zone information but must not be the source of truth.
- `delivery_zone_key` and `delivery_zone_id` must be separate concepts.
- Route review zones must not be treated as standard checkout zones.

## 7. Manual Capture / Route Review Contract

Route review zones use Stripe manual capture only.

Required behavior:

- A route review checkout creates or updates a `DeliveryApprovalRequest` or canonical equivalent.
- The customer authorizes payment, but the Order must not become fully confirmed until approval.
- Stripe authorization must use manual capture.
- Approval captures the authorization when appropriate and creates or advances the canonical Order.
- Denial releases or cancels the authorization when possible.
- Denial may create or update a waitlist/lead record.
- Route review approval must assign final schedule fields through the backend schedule engine.
- Route review approval must preserve the audit trail, reviewer, decision timestamp, and customer-facing decision reason.

Order state:

- Before approval: request pending, authorization pending or authorized, Order absent or clearly non-confirmed.
- After approval: Order confirmed with paid/captured payment state and canonical schedule fields.
- After denial: no confirmed Order should exist unless explicitly created for audit purposes with a non-fulfillable terminal state.

## 8. Waitlist Contract

`waitlist_only` zones cannot checkout.

Required behavior:

- Collect lead/waitlist information only.
- Do not create a checkout session.
- Do not create a PaymentIntent.
- Do not create a confirmed Order.
- Do not trigger fulfillment, Hub sync, or production scheduling.

Canonical waitlist fields:

| Field | Usage |
| --- | --- |
| `customer_email` | Customer email address. |
| `postal_code` | ZIP/postal code for delivery expansion analysis. |
| `customer_name` | Customer name when available. |
| `phone` | Customer phone number when available. |
| `address` | Human-readable address or delivery area description. |
| `notes` | Customer or system notes. |
| `source` | Source of the waitlist entry, such as `checkout`, `cart_delivery_check`, or `route_review_denial`. |

Rules:

- Legacy waitlist field names such as `email` and `zip` must be normalized to `customer_email` and `postal_code`.
- Duplicate detection should use at least `customer_email` and `postal_code`.
- Waitlist records must not be treated as Orders.

## 9. Health Advisory Contract

Frontend requirement:

- The frontend must require health advisory acknowledgment before payment.

Backend requirement:

- The backend must reject checkout if health advisory acknowledgment is missing or false.
- The backend must persist these fields on the checkout/order record:
  - `health_advisory_acknowledged`
  - `health_advisory_version`
  - `health_advisory_acknowledged_at`

Rules:

- Frontend display state cannot be the only record of acknowledgment.
- The persisted acknowledgment must survive webhook finalization, route review approval, and recovery flows.
- If the health advisory version changes, the frontend and backend must require acknowledgment of the active version.

## 10. Points / Rewards Contract

Points conversion:

- 100 points = $1.

Required behavior:

- `points_used` must be backend-validated.
- `points_discount` must be backend-calculated or backend-validated.
- Reward redemption must be backend-validated.
- Credits, referral discounts, and reward discounts must be validated by the backend before payment amount is finalized.
- Frontend reward display cannot be trusted as the source of truth.

Rules:

- The backend must ensure the customer owns enough points before accepting a redemption.
- The backend must prevent duplicate redemption from repeated checkout attempts or webhook retries.
- Points and rewards must be deducted only after payment success or route review approval, depending on the checkout path.
- Failed, canceled, abandoned, refunded, or denied checkouts must not permanently consume points unless explicitly supported by a separate policy.

## 11. Abandoned Checkout / Recovery Contract

Terminal safety is required.

Rules:

- `do_not_recover` must be respected by recovery functions.
- Abandoned checkouts must be terminal-safe.
- Canceled, refunded, failed, denied, or explicitly abandoned Orders must not be recovered unless an admin explicitly performs an allowed recovery action.
- Recovery functions must check terminal flags before creating Orders, syncing to Hub, sending notifications, awarding points, or advancing fulfillment.
- Webhook retries must be idempotent and must not revive terminal Orders.

Required terminal flags:

- `is_abandoned_checkout`
- `do_not_recover`
- `canceled_at`
- terminal `order_status` or legacy `status`
- payment/refund state

## 12. Subscription Checkout Contract

Subscription checkout must use the same backend schedule engine as one-time checkout.

Required behavior:

- First fulfillment date must be generated by the backend schedule engine.
- Subscription delivery cadence must use the canonical production and delivery cadence.
- Subscriptions are not allowed in `route_review` zones unless explicitly approved in a later contract.
- Subscriptions are not allowed in `waitlist_only` zones.
- Subscription checkout must validate delivery zone, minimums, customer eligibility, payment status, and health advisory requirements before becoming active.

Rules:

- Frontend subscription UI may display schedule options but must not calculate final schedule.
- Backend subscription creation must persist first fulfillment schedule fields consistently with Order schedule fields.
- Any future route review subscription workflow must have a separate approval contract.

## 13. Explicit Contradictions Resolved

The following contradictions are resolved by this contract:

- Saturday frontend 5 PM - 8 PM is incorrect. Canonical Saturday delivery is 12 PM - 3 PM.
- Frontend scheduling logic must be retired or reduced to display-only behavior after migration.
- Health advisory acknowledgment must persist server-side.
- Waitlist field names must be unified around `customer_email` and `postal_code`.
- `recoverStuckOrder` and any equivalent recovery flow must guard `do_not_recover`.
- Delivery zone key and delivery zone entity ID must be separate fields.
- Route review zones are not normal immediate checkout zones.

## 14. Open Questions / Blockers

Open questions:

- What is the final canonical entity name for route review: `DeliveryApprovalRequest` or a new platform equivalent?
- Will `assigned_production_day` replace `production_date`, or will both be kept during transition?
- Should backend schedule options be served by the existing schedule function or a new read-only schedule-options endpoint?
- What exact reward type enum will be canonical for discount rewards?
- Should route review denials always create waitlist records, or only when the customer opts in?
- What is the explicit admin recovery policy for paid but terminal Orders?

Blockers before implementation:

- Gate B canonical field mapping must be approved.
- Backend schedule function behavior must be audited against this contract.
- Checkout, webhook, route review, waitlist, points, rewards, and recovery flows need staging-only implementation plans.
- Stripe test-mode smoke tests must be defined before any production cutover.
- No record migration should begin until functions and schemas are verified in the NuVira Platform app.

## 15. Approval Gates

Next gates:

- Gate B: canonical field mapping.
- Gate C: backend scheduling function audit/update.
- Gate D: backend staging implementation.
- Gate E: Stripe test-mode smoke.
- Gate F: production cutover approval.

No checkout implementation, schema migration, Stripe behavior change, Hub behavior change, automation change, or production Customer App behavior change should proceed until the applicable gate is approved.
