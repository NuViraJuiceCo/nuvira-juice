# NuVira Checkout Scheduling Function Audit

Status: Gate C audit, documentation only.

Source documents:

- `docs/checkout-scheduling-contract.md`
- `docs/checkout-canonical-field-mapping.md`

This document audits scheduling-related frontend and backend code against the Gate A checkout/scheduling contract and Gate B canonical field mapping. It does not authorize app code changes, backend function edits, schema changes, Stripe changes, Hub changes, automation changes, production behavior changes, or record migration.

## Canonical Schedule Target

The approved cadence from Gate A is:

- Tuesday production -> Wednesday delivery, 5 PM - 8 PM.
- Friday production -> Saturday delivery, 12 PM - 3 PM.
- Cutoff is 2:00 PM America/Chicago.
- Exactly 2:00:00 PM is before/at cutoff.
- Any time after 2:00:00 PM is after cutoff.

Required canonical Order schedule fields:

- `assigned_production_day`
- `assigned_delivery_date`
- `delivery_window_label`
- `assigned_delivery_window_start`
- `assigned_delivery_window_end`
- `delivery_window_timezone`
- `final_schedule_source`
- `scheduling_reason`
- `cutoff_window_label`
- `schedule_timezone`

## Source-of-Truth Recommendation

Final backend source of truth:

- `calculateNuViraFulfillmentSchedule/entry.ts`

Recommendation:

- Keep `calculateNuViraFulfillmentSchedule` as the final schedule assignment authority.
- Use webhook event time or approval/capture time for final paid/approved order scheduling.
- Add or expose a backend schedule-options read path later so checkout can display backend-provided options only.
- Do not let `lib/deliveryUtils.js` or `DeliveryDatePicker.jsx` calculate final checkout schedule after migration.
- Backend should reject or override stale frontend selected schedule options.

## Scheduling Functions and Components Found

| File / function | Calculates schedule? | Current cadence result | Contract status | Required later change |
| --- | --- | --- | --- | --- |
| `calculateNuViraFulfillmentSchedule/entry.ts` | Yes, backend final schedule engine | Matches Tue/Fri production, Wed 5-8, Sat 12-3, 2 PM Chicago cutoff | Mostly compliant | Expand output/write mapping to canonical field names; fix ambiguous labels; add tests. |
| `lib/deliveryUtils.js` `DEFAULT_RULES` | Yes, frontend fallback | Sun/Mon/Tue -> Wed, Wed/Thu/Fri -> Sat, Sat -> Sun, cutoff 23 | Non-compliant | Retire for checkout scheduling; remove Sunday checkout behavior from checkout path. |
| `lib/deliveryUtils.js` `getNextDeliveryDate` | Yes, frontend | Uses `DeliverySchedule` rules or legacy defaults | Non-compliant for checkout | Do not use for checkout final schedule. Display-only only if backed by backend options. |
| `lib/deliveryUtils.js` `getDeliveryDisplayText` / `getDeliveryShortText` | Yes, frontend display from local calculation | Depends on `getNextDeliveryDate` | Non-compliant for checkout | Replace checkout usage with backend option display. |
| `lib/deliveryUtils.js` `getEligibleDeliveryOptions` | Yes, frontend option calculation | Uses Tue/Fri production and 2 PM cutoff, but all windows are 5-8 and optional Sunday exists | Partially compliant, high risk | Replace checkout source with backend schedule options. Saturday must be 12-3. |
| `lib/deliveryUtils.js` `getProductionInfo` | Yes, frontend urgency display | Tue/Fri production, 2 PM cutoff | Display-only acceptable outside checkout | Keep out of checkout source-of-truth path. |
| `checkout/DeliveryDatePicker.jsx` | No date math, but renders schedule options | Renders caller options; static copy says all deliveries 5-8 | Display component should remain display-only | Remove hardcoded all-deliveries 5-8 copy later; ensure options come from backend only. |
| `pages/Checkout.jsx` | Yes, frontend checkout schedule selection | Computes local delivery text/options; sends selected schedule fields to backend | Non-compliant after migration | Replace with backend-provided options and backend validation token/payload. |
| `createPaymentIntent/entry.ts` | Yes, backend PI creation schedule snapshot | Calls central schedule engine, but has 5-8 fallback and incomplete Order field persistence | Partially compliant | Remove unsafe fallback, persist canonical fields, reject stale selected options. |
| `stripeWebhook/entry.ts` checkout/session paths | Yes, backend finalization | Recalculates from Stripe event time; fallback may use stale metadata/default 5-8 | Partially compliant | Make central engine success required or use safe blocked state; persist all canonical fields. |
| `stripeWebhook/entry.ts` subscription invoice paths | Yes, backend subscription schedule | Recalculates from invoice/payment time; fallback defaults 5-8 | Partially compliant | Align subscription fields and remove unsafe default fallback. |
| `createZone3AuthorizationIntent/entry.ts` | No final schedule | Creates manual-capture authorization and DAR only | Compliant | Keep no confirmed Order/schedule before approval. |
| `approveZone3DeliveryRequest/entry.ts` | Yes, route review approval schedule | Calls central schedule engine at approval; fallback defaults 5-8 | Partially compliant | Remove unsafe fallback, persist canonical production/date/timezone fields. |
| `denyZone3DeliveryRequest/entry.ts` | No schedule | Cancels authorization, creates waitlist, sends notifications | Compliant for scheduling | No schedule fields should be written on denial. |
| `validateDeliveryEligibility/entry.ts` | No schedule; zone classification only | Returns zone, fee, minimums, route review/manual capture flags | Compliant as zone source | Add canonical zone field aliases later; do not mix with schedule calculation. |

## Detailed Findings

### `calculateNuViraFulfillmentSchedule/entry.ts`

Purpose:

- Backend central fulfillment schedule engine.
- Accepts `created_at`, `checkout_completed_at`, or `paid_at`.
- Converts input timestamp to `America/Chicago`.

Canonical alignment:

- Friday before/at 2 PM -> Friday production, Saturday delivery, 12 PM - 3 PM.
- Friday after 2 PM -> next Tuesday production, Wednesday delivery, 5 PM - 8 PM.
- Saturday/Sunday/Monday -> next Tuesday production, Wednesday delivery, 5 PM - 8 PM.
- Tuesday before/at 2 PM -> Tuesday production, Wednesday delivery, 5 PM - 8 PM.
- Tuesday after 2 PM -> next Friday production, Saturday delivery, 12 PM - 3 PM.
- Wednesday/Thursday -> next Friday production, Saturday delivery, 12 PM - 3 PM.
- Uses `timeInSeconds > cutoffInSeconds`, so exactly 2:00:00 PM is before/at cutoff.

Current output:

- `production_date`
- `delivery_date`
- `delivery_window_label`
- `delivery_window_start`
- `delivery_window_end`
- `cutoff_window_label`
- `schedule_reason`
- `timezone`

Contradictions / risks:

- Output does not directly include all canonical field names from Gate B.
- `assigned_production_day` remains unresolved: Gate B treats it as a production date, but some current code writes a weekday name.
- Saturday/Sunday/Monday `cutoff_window_label` can produce a misleading short label for Saturday because it uses a two-value Sun/Mon label helper.
- Window labels use `5:00 PM - 8:00 PM` / `12:00 PM - 3:00 PM`, while some frontend/backend defaults use `5 PM - 8 PM`; formatting should be normalized.

Required later changes:

- Add a canonical response wrapper or update consumers to map:
  - `production_date` -> `assigned_production_day` or final approved production date field.
  - `delivery_date` -> `assigned_delivery_date`.
  - `delivery_window_start` -> `assigned_delivery_window_start`.
  - `delivery_window_end` -> `assigned_delivery_window_end`.
  - `timezone` -> `delivery_window_timezone` and `schedule_timezone`.
  - `schedule_reason` -> `scheduling_reason`.
  - `final_schedule_source` = `backend_schedule_engine` unless admin/route review override.
- Decide whether `assigned_production_day` should be renamed or aliased because it is currently used inconsistently as both date and weekday label.
- Add fixtures for cutoff boundaries and zone flows before implementation.

### `lib/deliveryUtils.js`

Scheduling logic found:

- `DEFAULT_RULES`
- `getNextDeliveryDate`
- `getDeliveryDisplayText`
- `getDeliveryShortText`
- `getEligibleDeliveryOptions`
- `getProductionInfo`

Contradictions:

- `DEFAULT_RULES` includes Saturday -> Sunday delivery.
- `DEFAULT_RULES` uses `cutoff_hour: 23`, not 2 PM.
- `getNextDeliveryDate` uses local frontend calculation, not backend schedule authority.
- `getEligibleDeliveryOptions` includes optional Sunday support.
- `getEligibleDeliveryOptions` sets every option to `5 PM - 8 PM`, including Saturday.
- `getEligibleDeliveryOptions` is computed once in checkout with `new Date()` and is not revalidated if the page stays open across cutoff.

Required later changes:

- Remove checkout dependency on `getNextDeliveryDate`, `getDeliveryDisplayText`, and `getEligibleDeliveryOptions`.
- Keep these utilities only for non-checkout display if explicitly approved, or replace with backend schedule option reads.
- Ensure Saturday checkout windows display only `12 PM - 3 PM`.
- Ensure no Sunday delivery option appears in checkout unless a future approved schedule contract reintroduces it.

### `checkout/DeliveryDatePicker.jsx`

Scheduling logic found:

- Does not calculate dates or cutoff directly.
- Renders `options` and calls `onSelect`.
- Static helper copy says all deliveries arrive between 5 PM - 8 PM.

Contradictions:

- Static text conflicts with canonical Saturday 12 PM - 3 PM.
- Component comment says options come from `getEligibleDeliveryOptions`, which is frontend-calculated.

Required later changes:

- Make this component display-only.
- Remove hardcoded all-deliveries 5 PM - 8 PM copy.
- Update comments and usage so options are backend-provided.
- Keep selection payload round-tripped to backend for validation.

### `pages/Checkout.jsx`

Scheduling logic found:

- Imports `getDeliveryDisplayText`, `getNextDeliveryDate`, and `getEligibleDeliveryOptions`.
- Reads active `DeliverySchedule` entity.
- Calculates `deliveryDate` and `deliveryText` locally.
- Calculates delivery options locally once with `getEligibleDeliveryOptions(new Date(), false)`.
- Initializes `selectedDeliveryOption` from the first local option.
- Sends `estimated_delivery_date`, `selected_delivery_date`, `assigned_delivery_date`, `production_date`, `delivery_window_label`, `delivery_window_start`, `delivery_window_end`, and `delivery_schedule_source` to `createPaymentIntent`.
- Uses local/session storage for pending checkout session recovery, but not for schedule options.

Contradictions:

- Frontend calculates checkout schedule options.
- Frontend can display stale selected schedule options if cutoff passes while checkout remains open.
- Frontend sends selected schedule fields even though backend schedule engine should be authoritative.
- Default window fallback is `5 PM - 8 PM`.
- Delivery estimate displays local selected option instead of backend-authoritative option.
- Pending checkout storage cleanup happens before pending session read, which may make recovery behavior unreliable; this is not a schedule calculation but is stale checkout state risk.

Required later changes:

- Replace local checkout schedule calculation with backend schedule options.
- Submit selected backend option ID/snapshot to backend.
- Backend must validate the selected option against current schedule state.
- Backend may reject stale selected options or return corrected options.
- Remove frontend hardcoded schedule fallback values from checkout request payload.
- Keep `DeliveryDatePicker` as display-only.

### `createPaymentIntent/entry.ts`

Scheduling logic found:

- Destructures frontend schedule fields but calls `calculateNuViraFulfillmentSchedule` with current server time.
- Uses central schedule result for Stripe metadata, pending Order schedule fields, and CheckoutSession snapshot.
- Revalidates delivery eligibility server-side before creating the PaymentIntent.
- Blocks route review zones from normal PaymentIntent flow.

Canonical alignment:

- Correctly treats the backend schedule function as PI creation-time source.
- Does not appear to trust frontend schedule for final metadata when central engine succeeds.

Contradictions / risks:

- If central schedule call fails, fallback sets next-day delivery and `5 PM - 8 PM`, which can violate Saturday 12 PM - 3 PM and production cadence.
- Pending Order create persists `assigned_delivery_date`, `delivery_window_label`, start/end, but does not persist all canonical schedule fields.
- Pending Order create does not persist `production_date` or a canonical production date field.
- Pending Order create does not persist `delivery_window_timezone`, `final_schedule_source`, `scheduling_reason`, `cutoff_window_label`, or `schedule_timezone`.
- CheckoutSession snapshot stores `production_date` and window fields, but not the full canonical field set.
- `delivery_zone_id` is currently populated from `eligibility.zone_key`, which violates Gate B's key-vs-ID split.
- No explicit stale selected frontend option validation exists yet.

Required later changes:

- Treat schedule engine failure as checkout-blocking or return a recoverable error instead of unsafe fallback defaults.
- Persist all canonical schedule fields consistently in pending Order and CheckoutSession snapshots if pending records are kept.
- Split `delivery_zone_key` from `delivery_zone_id`.
- Add selected schedule option validation once backend schedule options exist.
- Normalize `final_schedule_source` to `backend_schedule_engine`.

### `stripeWebhook/entry.ts`

Scheduling logic found:

- `checkout.session.completed` recalculates final schedule from Stripe event time.
- `payment_intent.succeeded` recalculates final schedule from Stripe event time.
- Safety-net order creation attempts central schedule calculation.
- Subscription invoice paths recalculate from invoice paid/event time.

Canonical alignment:

- Final payment event time is correctly treated as final authority over stale session or PaymentIntent creation time.
- This matches Gate A: if payment crosses cutoff, webhook time wins.

Contradictions / risks:

- Fallbacks can use CheckoutSession/metadata/default `5 PM - 8 PM`.
- `payment_intent.succeeded` final update writes `assigned_production_day` as a weekday label, not a production date.
- `payment_intent.succeeded` final update does not write `production_date` in the audited update block.
- Safety-net Order create writes delivery fields but not full canonical production/date/timezone/source fields.
- Some notification payload fallbacks still use metadata selected date/window.
- No `delivery_window_timezone` field is written in the audited webhook schedule writes.
- Hosted checkout and subscription invoice paths still carry fallback defaults.

Required later changes:

- Make central schedule success required for final operational Order creation, or place the order into a non-operational blocked state until schedule is resolved.
- Persist all canonical schedule fields from the central engine on every paid/approved Order path.
- Resolve `assigned_production_day` naming before implementation.
- Remove unsafe Saturday `5 PM - 8 PM` fallback defaults.
- Ensure notification payloads use final persisted canonical schedule fields only.

### `createZone3AuthorizationIntent/entry.ts`

Scheduling logic found:

- No final schedule calculation.
- Creates a manual-capture PaymentIntent and `DeliveryApprovalRequest`.
- Does not create an Order, sync Hub, or seed production.

Canonical alignment:

- Compliant with Gate A for route review initiation.
- Route review zones should not create fully confirmed Orders before approval.

Required later changes:

- No schedule calculation should be added here.
- If schedule preview is shown in route review UI later, it must be backend-provided and clearly non-final.

### `approveZone3DeliveryRequest/entry.ts`

Scheduling logic found:

- After admin approval and Stripe capture, calls `calculateNuViraFulfillmentSchedule` with current server time.
- Creates a confirmed Order with delivery date/window fields.

Canonical alignment:

- Correctly schedules route review at approval/capture time.

Contradictions / risks:

- Schedule fallback uses next-day delivery and `5 PM - 8 PM`.
- Order create does not persist `production_date` or canonical `assigned_production_day`.
- Order create does not persist `delivery_window_timezone`.
- `delivery_zone_id` is populated from `dar.zone_key`, not a true DeliveryZone entity ID.
- `final_schedule_source` is `central_engine`; Gate B recommends controlled values such as `backend_schedule_engine` or `route_review_approval`.

Required later changes:

- Make schedule engine failure block approval/order creation or create a non-operational blocked state.
- Persist full canonical schedule field set.
- Split `delivery_zone_key` and `delivery_zone_id`.
- Use a controlled `final_schedule_source` value.

### `denyZone3DeliveryRequest/entry.ts`

Scheduling logic found:

- No schedule calculation.
- Cancels authorization, creates waitlist record, updates DAR, sends notifications.

Canonical alignment:

- Compliant for scheduling because denial should not create a confirmed Order or schedule fulfillment.

Required later changes:

- No schedule fields should be written on denial.
- Waitlist field mapping is covered by Gate B and should be handled in a separate implementation gate.

### `validateDeliveryEligibility/entry.ts`

Scheduling logic found:

- No production date, delivery date, cutoff, or delivery window calculation.
- Classifies zones and returns fees, minimums, checkout flags, manual capture flags, and subscription eligibility.

Canonical alignment:

- Compliant as delivery-zone source, not schedule source.
- Correctly marks route review zones as `manual_capture_required: true` and `allowed_for_subscriptions: false`.
- Correctly marks waitlist zones as `checkout_allowed: false`.

Contradictions / risks:

- Route review zones return `checkout_allowed: true`, while normal checkout must still branch away from automatic capture. The function also returns `automatic_checkout_allowed`, which should be used to avoid ambiguity.
- Delivery zone response does not provide `delivery_zone_id`; it provides `zone_key`.
- No delivery-days/window information is returned; this is acceptable if schedule engine owns schedule.

Required later changes:

- Keep delivery eligibility separate from scheduling.
- Rename or alias response fields to Gate B canonical names:
  - `zone_key` -> `delivery_zone_key`
  - `minimum_order` -> `minimum_order_amount`
- Ensure callers use `manual_capture_required` / `automatic_checkout_allowed` to choose normal checkout vs route review.

## Contradictions Resolved By This Audit

| Contradiction | Location | Resolution for later implementation |
| --- | --- | --- |
| Saturday displayed as `5 PM - 8 PM` | `lib/deliveryUtils.js`, `DeliveryDatePicker.jsx`, checkout fallback payloads, backend fallbacks | Canonical Saturday is `12 PM - 3 PM`; frontend must display backend options only. |
| Sunday delivery logic still exists | `lib/deliveryUtils.js` `DEFAULT_RULES`, optional Sunday option | Sunday is not part of Gate A checkout cadence and must not appear in checkout. |
| Frontend-only schedule calculation | `pages/Checkout.jsx`, `lib/deliveryUtils.js` | Checkout schedule options must come from backend. |
| 11 PM cutoff legacy fallback | `lib/deliveryUtils.js` `DEFAULT_RULES` | Checkout cutoff is 2 PM America/Chicago only. |
| Unsafe schedule fallbacks | `createPaymentIntent`, `stripeWebhook`, `approveZone3DeliveryRequest` | Schedule engine failure must not silently create operational Orders with default 5-8 windows. |
| `assigned_production_day` ambiguity | `stripeWebhook`, Gate B mapping, current schemas | Must resolve as date field or introduce clear alias before Gate D implementation. |
| Stale selected frontend option | `pages/Checkout.jsx` | Backend must validate selected option at checkout/payment time and reject or override stale values. |
| Zone key stored as zone ID | `createPaymentIntent`, `approveZone3DeliveryRequest` | Split `delivery_zone_key` and `delivery_zone_id`. |

## Required Changes Later

No changes are made in Gate C. These are required for later Gate D planning:

1. Backend schedule API

- Keep `calculateNuViraFulfillmentSchedule` as final authority.
- Add canonical response mapping for required Order schedule fields.
- Add or expose a backend schedule-options read endpoint for checkout display.
- Include a selected option ID/hash/timestamp so backend can detect stale selections.

2. Frontend checkout

- Remove checkout dependency on `getEligibleDeliveryOptions`, `getNextDeliveryDate`, and `getDeliveryDisplayText`.
- Fetch backend schedule options.
- Render backend options only in `DeliveryDatePicker`.
- Submit selected backend option payload/ID for validation.
- Remove hardcoded delivery window defaults from checkout payload.

3. Backend checkout creation

- In `createPaymentIntent`, reject or block checkout if schedule engine fails.
- Persist schedule snapshot with full canonical fields.
- Stop storing delivery zone key in `delivery_zone_id`.
- Validate selected frontend option against backend-generated options.

4. Webhook finalization

- Require central schedule success before operational Order finalization, or create a non-operational schedule-blocked state.
- Persist full canonical fields on every paid path.
- Use final persisted schedule fields for notifications.
- Remove unsafe `5 PM - 8 PM` fallback defaults.

5. Route review approval

- Schedule only at approval/capture time.
- Block approval/order creation if schedule engine fails.
- Persist full canonical schedule fields.
- Split delivery zone key from entity ID.

6. Data model decision

- Resolve whether canonical production date is `assigned_production_day`, `production_date`, or both during transition.
- If `assigned_production_day` remains, define it as `YYYY-MM-DD`, not weekday label.

## Test Fixture List

All timestamp fixtures must be interpreted in `America/Chicago`.

| Fixture | Input example | Expected production | Expected delivery | Expected window | Required assertion |
| --- | --- | --- | --- | --- | --- |
| Friday 1:59 PM | `2026-05-22T13:59:00-05:00` | `2026-05-22` Friday | `2026-05-23` Saturday | `12 PM - 3 PM` | Before/at Friday cutoff stays Friday/Saturday. |
| Friday 2:01 PM | `2026-05-22T14:01:00-05:00` | `2026-05-26` Tuesday | `2026-05-27` Wednesday | `5 PM - 8 PM` | After Friday cutoff moves to Tuesday/Wednesday. |
| Tuesday 1:59 PM | `2026-05-26T13:59:00-05:00` | `2026-05-26` Tuesday | `2026-05-27` Wednesday | `5 PM - 8 PM` | Before/at Tuesday cutoff stays Tuesday/Wednesday. |
| Tuesday 2:01 PM | `2026-05-26T14:01:00-05:00` | `2026-05-29` Friday | `2026-05-30` Saturday | `12 PM - 3 PM` | After Tuesday cutoff moves to Friday/Saturday. |
| Saturday noon | `2026-05-23T12:00:00-05:00` | `2026-05-26` Tuesday | `2026-05-27` Wednesday | `5 PM - 8 PM` | Saturday never creates Sunday delivery under Gate A. |
| Monday noon | `2026-05-25T12:00:00-05:00` | `2026-05-26` Tuesday | `2026-05-27` Wednesday | `5 PM - 8 PM` | Monday schedules next/current Tuesday production. |
| Wednesday noon | `2026-05-27T12:00:00-05:00` | `2026-05-29` Friday | `2026-05-30` Saturday | `12 PM - 3 PM` | Wednesday schedules Friday/Saturday. |
| Route review zone | Zone type `route_review` | No final schedule at authorization | Schedule at approval/capture time | Based on approval time | Normal checkout blocked; manual capture only; Order not confirmed until approved. |
| Waitlist-only zone | Zone type `waitlist_only` | None | None | None | No checkout, no PaymentIntent, no Order, no schedule. |
| Stale frontend selected delivery option | Option generated before cutoff, submitted after cutoff | Backend-current schedule | Backend-current delivery | Backend-current window | Backend rejects stale option or overrides with current validated schedule; stale frontend values are not persisted. |

Additional boundary fixtures recommended:

- Tuesday exactly `14:00:00` -> Tuesday/Wednesday.
- Tuesday `14:00:01` -> Friday/Saturday.
- Friday exactly `14:00:00` -> Friday/Saturday.
- Friday `14:00:01` -> Tuesday/Wednesday.
- Daylight saving time transition weeks.
- Missing/invalid timestamp -> 400 response from schedule function.
- Schedule engine unavailable -> checkout/approval must not create operational Order.

## Gate C Decision Lock

These decisions are locked for Gate D planning. They do not authorize implementation.

1. `assigned_production_day` meaning

- `assigned_production_day` is a date string, not a weekday label.
- Required format: `YYYY-MM-DD`.
- If a weekday label is needed for display, UI must derive it from the date.
- Existing code that writes `Tuesday`, `Friday`, or another weekday label to `assigned_production_day` must be corrected in later implementation.

2. Backend schedule options endpoint

- `calculateNuViraFulfillmentSchedule/entry.ts` remains the backend source-of-truth function.
- If checkout needs multiple selectable options, add or read an options mode from this function later.
- Do not create a separate competing schedule function.
- Any options-mode output must use the same cutoff rules, timezone, and canonical field mapping as the final schedule calculation.

3. Stale frontend schedule selection

- Frontend selected delivery options are advisory only.
- Backend must revalidate schedule during payment intent/order creation.
- If a selected option is stale or no longer valid, backend must either override with the current valid backend schedule or reject checkout with a clear customer-safe error.
- Stale frontend schedule fields must not be persisted as final Order schedule fields.

4. Schedule failure policy

- Checkout must fail closed.
- If the backend cannot calculate a valid schedule, do not create a PaymentIntent.
- If the backend cannot calculate a valid schedule, do not create an Order.
- Return a customer-safe error that asks the customer to try again or contact support.
- Unsafe fallback defaults such as next-day delivery or `5 PM - 8 PM` must not create operational records.

5. Saturday delivery window

- Canonical Saturday delivery window is `12 PM - 3 PM`.
- Any Saturday `5 PM - 8 PM` fallback is invalid.
- All Saturday `5 PM - 8 PM` fallback paths must be removed in later implementation.

6. Frontend `DeliveryDatePicker`

- `DeliveryDatePicker` becomes display/selection only.
- It must not calculate final production dates, delivery dates, cutoff eligibility, or delivery windows after migration.
- It must render backend-provided options only.

7. Route review approval schedule

- Route review orders receive final schedule at approval time, not authorization time.
- Approval must write the full canonical schedule field set.
- Route review authorization may store a non-final preview only if clearly marked as advisory.

8. Subscription first fulfillment

- First subscription fulfillment uses the same backend scheduling function as one-time orders.
- Subscription checkout must not use an independent schedule calculator for first fulfillment.
- The first fulfillment schedule must be generated and persisted by the backend.

## Gate D Planning Readiness

Gate D backend staging implementation is safe to plan after approval of this audit and the Gate C Decision Lock.

Remaining planning blockers:

- Confirm transition alias policy for existing `production_date` fields.
- Confirm exact customer-safe schedule failure error copy.
- Confirm canonical `final_schedule_source` enum values.
- Confirm whether schedule-options mode returns one earliest option, multiple selectable options, or both.
- Confirm test harness location and fixture format.

Gate D is safe to plan, but not safe to execute. No implementation was performed in Gate C.
